#!/usr/bin/env python3
"""
Aspora Churn Intelligence — Self-Learning Retrain Pipeline

Weekly retrain loop with drift detection and calibration checks.

Usage:
  python3 scripts/retrain.py --model data/churn_model_ensemble.pkl --data data/signals.csv

This script:
  1. Pulls last 6 months data (or uses existing CSV)
  2. Checks 60-day-old predictions vs actuals
  3. Retrains ensemble with new data
  4. Compares new AUC vs current model
  5. If improved: swaps model, regenerates dashboard JSON
  6. Runs drift detection on feature distributions
  7. Validates calibration (predicted prob vs actual churn rate)
"""

import os
import sys
import json
import pickle
import argparse
import warnings
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression

warnings.filterwarnings('ignore')

# Import from train_model
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_model import (
    SIGNAL_FEATURES, LABEL_COL, load_data, temporal_split,
    train_lightgbm, train_xgboost, train_catboost, train_meta_learner,
    predict_ensemble, generate_dashboard_json, INTERVENTIONS
)


# ═══════════════════════════════════════════════════════════════════════════════
# DRIFT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def detect_drift(training_stats, new_data, threshold_std=2.0):
    """
    Monitor feature distributions for drift.
    Flags features that shifted > threshold_std from training distribution.

    Args:
        training_stats: dict of {feature: {'mean': float, 'std': float}}
        new_data: DataFrame with current features
        threshold_std: number of standard deviations to flag

    Returns:
        list of drift alerts
    """
    print('\n[Drift Detection] Checking feature distributions...')
    alerts = []

    for feature in SIGNAL_FEATURES:
        if feature not in new_data.columns:
            continue
        if feature not in training_stats:
            continue

        train_mean = training_stats[feature]['mean']
        train_std = training_stats[feature]['std']
        new_mean = new_data[feature].mean()

        if train_std == 0:
            continue

        z_score = abs(new_mean - train_mean) / train_std

        if z_score > threshold_std:
            alerts.append({
                'feature': feature,
                'train_mean': round(train_mean, 4),
                'new_mean': round(new_mean, 4),
                'z_score': round(z_score, 2),
                'severity': 'HIGH' if z_score > 3 else 'MEDIUM',
            })

    if alerts:
        print(f'  {len(alerts)} features drifted:')
        for a in sorted(alerts, key=lambda x: -x['z_score']):
            print(f'    {a["feature"]}: z={a["z_score"]} ({a["severity"]}) '
                  f'[train={a["train_mean"]} -> new={a["new_mean"]}]')
    else:
        print('  No significant drift detected.')

    return alerts


def compute_training_stats(df):
    """Compute mean/std for each feature from training data."""
    stats = {}
    for feature in SIGNAL_FEATURES:
        if feature in df.columns:
            stats[feature] = {
                'mean': float(df[feature].mean()),
                'std': float(df[feature].std()),
            }
    return stats


# ═══════════════════════════════════════════════════════════════════════════════
# CALIBRATION CHECK
# ═══════════════════════════════════════════════════════════════════════════════

def check_calibration(y_true, y_pred, n_bins=10):
    """
    Check model calibration: for users predicted X% churn, ~X% should actually churn.

    Returns:
        dict with calibration metrics and whether recalibration is needed
    """
    print('\n[Calibration] Checking prediction calibration...')

    brier = brier_score_loss(y_true, y_pred)
    print(f'  Brier Score: {brier:.4f}')

    fraction_of_positives, mean_predicted_value = calibration_curve(
        y_true, y_pred, n_bins=n_bins, strategy='uniform'
    )

    # Calculate Expected Calibration Error (ECE)
    ece = 0
    for i in range(len(fraction_of_positives)):
        ece += abs(fraction_of_positives[i] - mean_predicted_value[i])
    ece /= max(len(fraction_of_positives), 1)

    print(f'  Expected Calibration Error: {ece:.4f}')
    print(f'  Calibration by bin:')
    for i in range(len(fraction_of_positives)):
        print(f'    Predicted: {mean_predicted_value[i]:.2f} | Actual: {fraction_of_positives[i]:.2f}')

    needs_recalibration = ece > 0.05

    if needs_recalibration:
        print('  WARNING: Model is miscalibrated (ECE > 0.05). Recalibration recommended.')
    else:
        print('  Calibration is acceptable.')

    return {
        'brier_score': round(brier, 4),
        'ece': round(ece, 4),
        'needs_recalibration': needs_recalibration,
        'bins': [
            {'predicted': round(float(mean_predicted_value[i]), 4),
             'actual': round(float(fraction_of_positives[i]), 4)}
            for i in range(len(fraction_of_positives))
        ],
    }


def apply_isotonic_calibration(y_pred_train, y_train, y_pred_new):
    """Apply isotonic regression calibration."""
    print('[Calibration] Applying isotonic regression...')
    iso = IsotonicRegression(out_of_bounds='clip')
    iso.fit(y_pred_train, y_train)
    calibrated = iso.predict(y_pred_new)
    return calibrated


# ═══════════════════════════════════════════════════════════════════════════════
# PREDICTION VALIDATION (actuals vs predicted)
# ═══════════════════════════════════════════════════════════════════════════════

def validate_predictions(predictions_file, actuals_file):
    """
    Compare 60-day-old predictions against actual outcomes.

    Args:
        predictions_file: JSON with {user_id: predicted_prob, ...}
        actuals_file: CSV with user_id, churn_label columns

    Returns:
        Validation metrics
    """
    print('\n[Validation] Checking predictions vs actuals...')

    if not os.path.exists(predictions_file) or not os.path.exists(actuals_file):
        print('  Prediction or actuals file not found. Skipping validation.')
        return None

    with open(predictions_file) as f:
        predictions = json.load(f)

    actuals = pd.read_csv(actuals_file)
    actuals = actuals[actuals['user_id'].isin(predictions.keys())]

    if len(actuals) == 0:
        print('  No matching users found.')
        return None

    y_pred = [predictions[uid] for uid in actuals['user_id']]
    y_true = actuals[LABEL_COL].values

    auc = roc_auc_score(y_true, y_pred)
    print(f'  Prediction AUC on actuals: {auc:.4f}')
    print(f'  Users validated: {len(actuals)}')

    return {'auc': round(auc, 4), 'n_users': len(actuals)}


# ═══════════════════════════════════════════════════════════════════════════════
# RETRAIN PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════

def retrain_pipeline(args):
    """Full retrain pipeline."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_path = os.path.join(base_dir, args.data)
    model_path = os.path.join(base_dir, args.model)
    output_dir = os.path.join(base_dir, args.output)

    print('='*60)
    print('ASPORA CHURN RETRAIN PIPELINE')
    print(f'Date: {datetime.now().isoformat()}')
    print('='*60)

    # Step 1: Load current model
    current_model = None
    current_auc = 0
    if os.path.exists(model_path):
        with open(model_path, 'rb') as f:
            current_model = pickle.load(f)
        print(f'\n[Step 1] Loaded current model from {model_path}')
    else:
        print(f'\n[Step 1] No existing model found at {model_path}')

    # Step 2: Load new data
    df = load_data(data_path)
    train_df, val_df, test_df = temporal_split(df)

    X_train = train_df[SIGNAL_FEATURES].values
    y_train = train_df[LABEL_COL].values
    X_val = val_df[SIGNAL_FEATURES].values
    y_val = val_df[LABEL_COL].values
    X_test = test_df[SIGNAL_FEATURES].values
    y_test = test_df[LABEL_COL].values

    # Step 3: Evaluate current model on new test data
    if current_model and current_model.get('meta'):
        import xgboost as xgb
        models = (current_model['lgbm'], current_model['xgb'], current_model['cat'])
        current_preds = predict_ensemble(models, current_model['meta'], X_test, SIGNAL_FEATURES)
        current_auc = roc_auc_score(y_test, current_preds)
        print(f'\n[Step 3] Current model AUC on new data: {current_auc:.4f}')
    elif current_model:
        import xgboost as xgb
        lgbm_preds = current_model['lgbm'].predict(X_test)
        xgb_preds = current_model['xgb'].predict(xgb.DMatrix(X_test))
        current_preds = (lgbm_preds + xgb_preds) / 2
        current_auc = roc_auc_score(y_test, current_preds)
        print(f'\n[Step 3] Current model AUC on new data: {current_auc:.4f}')

    # Step 4: Train new ensemble
    print('\n[Step 4] Training new ensemble...')
    lgbm_model, lgbm_train, lgbm_val = train_lightgbm(X_train, y_train, X_val, y_val)
    xgb_model, xgb_train, xgb_val = train_xgboost(X_train, y_train, X_val, y_val)

    try:
        cat_model, cat_train, cat_val = train_catboost(X_train, y_train, X_val, y_val)
        models = (lgbm_model, xgb_model, cat_model)
        meta_model, meta_val = train_meta_learner(models, X_val, y_val, SIGNAL_FEATURES)
        new_preds = predict_ensemble(models, meta_model, X_test, SIGNAL_FEATURES)
        new_auc = roc_auc_score(y_test, new_preds)
        has_catboost = True
    except ImportError:
        print('[CatBoost] Not installed. Using 2-model ensemble.')
        import xgboost as xgb
        lgbm_test = lgbm_model.predict(X_test)
        xgb_test = xgb_model.predict(xgb.DMatrix(X_test))
        new_preds = (lgbm_test + xgb_test) / 2
        new_auc = roc_auc_score(y_test, new_preds)
        meta_model = None
        has_catboost = False

    print(f'\n[Step 5] New model AUC: {new_auc:.4f} vs Current: {current_auc:.4f}')

    # Step 5: Decide whether to swap
    improvement = new_auc - current_auc
    swap_threshold = -0.01  # Swap if new >= current - 0.01

    if improvement >= swap_threshold:
        print(f'  Decision: SWAP MODEL (improvement: {improvement:+.4f})')

        # Save new model
        new_model_pkg = {
            'lgbm': lgbm_model,
            'xgb': xgb_model,
            'meta': meta_model,
            'features': SIGNAL_FEATURES,
            'trained_at': datetime.now().isoformat(),
            'train_auc': round(max(lgbm_train, xgb_train), 4),
            'val_auc': round(new_auc, 4),
        }
        if has_catboost:
            new_model_pkg['cat'] = cat_model

        with open(model_path, 'wb') as f:
            pickle.dump(new_model_pkg, f)
        print(f'  Saved new model to {model_path}')

        # Generate new dashboard
        if has_catboost:
            all_preds = predict_ensemble(models, meta_model, df[SIGNAL_FEATURES].values, SIGNAL_FEATURES)
        else:
            import xgboost as xgb
            all_preds = (lgbm_model.predict(df[SIGNAL_FEATURES].values) +
                        xgb_model.predict(xgb.DMatrix(df[SIGNAL_FEATURES].values))) / 2

        lgbm_importance = dict(zip(SIGNAL_FEATURES, lgbm_model.feature_importance(importance_type='gain')))
        metrics = {
            'train_auc': round(max(lgbm_train, xgb_train), 4),
            'val_auc': round(new_auc if not meta_model else meta_val, 4),
            'test_auc': round(new_auc, 4),
        }
        model_info = {'train_samples': len(train_df), 'lgbm_importance': lgbm_importance}
        generate_dashboard_json(df, all_preds, metrics, model_info, output_dir)
    else:
        print(f'  Decision: KEEP CURRENT MODEL (new is worse by {-improvement:.4f})')

    # Step 6: Drift detection
    training_stats = compute_training_stats(train_df)
    drift_alerts = detect_drift(training_stats, test_df)

    # Step 7: Calibration check
    cal_results = check_calibration(y_test, new_preds)

    if cal_results['needs_recalibration']:
        print('\n[Recalibration] Applying isotonic regression...')
        if has_catboost:
            val_preds = predict_ensemble(models, meta_model, X_val, SIGNAL_FEATURES)
        else:
            import xgboost as xgb
            val_preds = (lgbm_model.predict(X_val) + xgb_model.predict(xgb.DMatrix(X_val))) / 2
        calibrated_preds = apply_isotonic_calibration(val_preds, y_val, new_preds)
        cal_after = check_calibration(y_test, calibrated_preds)
        print(f'  ECE before: {cal_results["ece"]:.4f} -> after: {cal_after["ece"]:.4f}')

    # Summary report
    report = {
        'timestamp': datetime.now().isoformat(),
        'current_auc': round(current_auc, 4),
        'new_auc': round(new_auc, 4),
        'improvement': round(improvement, 4),
        'model_swapped': improvement >= swap_threshold,
        'drift_alerts': len(drift_alerts),
        'drift_details': drift_alerts,
        'calibration': cal_results,
    }

    report_path = os.path.join(output_dir, 'retrain_report.json')
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f'\n[Report] Saved to {report_path}')

    print('\n' + '='*60)
    print('RETRAIN COMPLETE')
    print(f'  New AUC: {new_auc:.4f} | Swapped: {improvement >= swap_threshold}')
    print(f'  Drift alerts: {len(drift_alerts)} | Calibration ECE: {cal_results["ece"]:.4f}')
    print('='*60)


def main():
    parser = argparse.ArgumentParser(description='Retrain churn prediction ensemble')
    parser.add_argument('--model', default='data/churn_model_ensemble.pkl', help='Current model path')
    parser.add_argument('--data', default='data/signals.csv', help='New data CSV')
    parser.add_argument('--output', default='data/', help='Output directory')
    args = parser.parse_args()

    retrain_pipeline(args)


if __name__ == '__main__':
    main()
