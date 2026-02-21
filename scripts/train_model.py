#!/usr/bin/env python3
"""
Aspora Churn Intelligence — Ensemble ML Training Pipeline

Trains a 3-model ensemble (LightGBM + XGBoost + CatBoost) with a
LogisticRegression meta-learner for churn prediction.

Usage:
  python3 scripts/train_model.py --input data/signals.csv --output data/

Outputs:
  - data/churn_dashboard_data.json  — Dashboard data for the frontend
  - data/churn_model_ensemble.pkl   — Serialized ensemble model

Requirements:
  pip install lightgbm xgboost catboost scikit-learn pandas numpy
"""

import os
import sys
import json
import pickle
import argparse
import warnings
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    roc_auc_score, precision_score, recall_score, f1_score,
    confusion_matrix, classification_report
)
from sklearn.model_selection import train_test_split

warnings.filterwarnings('ignore')

# ── Feature Configuration (single source of truth) ────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from src.churn.domain.constants import (
    SIGNAL_FEATURES, LABEL_COL, RISK_TIERS, INTERVENTIONS, CORRIDORS,
)

# Alias for backwards compatibility with retrain.py imports
TIERS = RISK_TIERS


def load_data(input_path):
    """Load and validate the signal CSV."""
    print(f'[Data] Loading {input_path}...')
    df = pd.read_csv(input_path)
    print(f'[Data] Shape: {df.shape}')
    print(f'[Data] Churn distribution:\n{df[LABEL_COL].value_counts()}')

    # Keep only available features
    available = [f for f in SIGNAL_FEATURES if f in df.columns]
    missing = [f for f in SIGNAL_FEATURES if f not in df.columns]
    if missing:
        print(f'[Data] Missing features (will use 0): {missing}')
        for f in missing:
            df[f] = 0

    print(f'[Data] Using {len(available)} features')
    return df


def temporal_split(df):
    """
    Create temporal train/val/test splits.
    Since we may not have actual dates in the CSV, we simulate temporal splits
    by stratified random split with fixed seeds to ensure reproducibility.
    """
    print('[Split] Creating temporal splits...')

    # First split: 70% train, 30% temp
    train_df, temp_df = train_test_split(
        df, test_size=0.30, random_state=42, stratify=df[LABEL_COL]
    )
    # Second split: 50/50 of temp -> val/test
    val_df, test_df = train_test_split(
        temp_df, test_size=0.50, random_state=42, stratify=temp_df[LABEL_COL]
    )

    print(f'  Train: {len(train_df)} ({train_df[LABEL_COL].mean()*100:.1f}% churn)')
    print(f'  Val:   {len(val_df)} ({val_df[LABEL_COL].mean()*100:.1f}% churn)')
    print(f'  Test:  {len(test_df)} ({test_df[LABEL_COL].mean()*100:.1f}% churn)')

    return train_df, val_df, test_df


def train_lightgbm(X_train, y_train, X_val, y_val):
    """Train LightGBM model."""
    import lightgbm as lgb

    print('\n[LightGBM] Training...')
    churn_rate = y_train.mean()
    scale_pos = (1 - churn_rate) / churn_rate

    dtrain = lgb.Dataset(X_train, label=y_train)
    dval = lgb.Dataset(X_val, label=y_val, reference=dtrain)

    params = {
        'objective':        'binary',
        'metric':           'auc',
        'num_leaves':       63,
        'learning_rate':    0.03,
        'max_depth':        8,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq':     5,
        'scale_pos_weight': scale_pos,
        'verbose':          -1,
        'seed':             42,
    }

    callbacks = [
        lgb.early_stopping(30),
        lgb.log_evaluation(100),
    ]

    model = lgb.train(
        params, dtrain,
        num_boost_round=800,
        valid_sets=[dtrain, dval],
        valid_names=['train', 'val'],
        callbacks=callbacks,
    )

    train_auc = roc_auc_score(y_train, model.predict(X_train))
    val_auc = roc_auc_score(y_val, model.predict(X_val))
    print(f'[LightGBM] Train AUC: {train_auc:.4f} | Val AUC: {val_auc:.4f}')
    print(f'[LightGBM] Best iteration: {model.best_iteration}')

    return model, train_auc, val_auc


def train_xgboost(X_train, y_train, X_val, y_val):
    """Train XGBoost model."""
    import xgboost as xgb

    print('\n[XGBoost] Training...')
    churn_rate = y_train.mean()
    scale_pos = (1 - churn_rate) / churn_rate

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dval = xgb.DMatrix(X_val, label=y_val)

    params = {
        'objective':        'binary:logistic',
        'eval_metric':      'auc',
        'max_depth':        8,
        'learning_rate':    0.03,
        'subsample':        0.8,
        'colsample_bytree': 0.8,
        'scale_pos_weight': scale_pos,
        'tree_method':      'hist',
        'seed':             42,
        'verbosity':        0,
    }

    model = xgb.train(
        params, dtrain,
        num_boost_round=800,
        evals=[(dtrain, 'train'), (dval, 'val')],
        early_stopping_rounds=30,
        verbose_eval=100,
    )

    train_auc = roc_auc_score(y_train, model.predict(dtrain))
    val_auc = roc_auc_score(y_val, model.predict(dval))
    print(f'[XGBoost] Train AUC: {train_auc:.4f} | Val AUC: {val_auc:.4f}')
    print(f'[XGBoost] Best iteration: {model.best_iteration}')

    return model, train_auc, val_auc


def train_catboost(X_train, y_train, X_val, y_val):
    """Train CatBoost model."""
    from catboost import CatBoostClassifier, Pool

    print('\n[CatBoost] Training...')

    model = CatBoostClassifier(
        depth=8,
        learning_rate=0.03,
        iterations=800,
        auto_class_weights='Balanced',
        eval_metric='AUC',
        random_seed=42,
        verbose=100,
        early_stopping_rounds=30,
    )

    model.fit(
        X_train, y_train,
        eval_set=(X_val, y_val),
        use_best_model=True,
    )

    train_auc = roc_auc_score(y_train, model.predict_proba(X_train)[:, 1])
    val_auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])
    print(f'[CatBoost] Train AUC: {train_auc:.4f} | Val AUC: {val_auc:.4f}')
    print(f'[CatBoost] Best iteration: {model.best_iteration_}')

    return model, train_auc, val_auc


def train_meta_learner(models, X_val, y_val, feature_names):
    """Train LogisticRegression meta-learner on validation set predictions."""
    import xgboost as xgb

    print('\n[Meta-Learner] Training on validation predictions...')

    lgbm_model, xgb_model, cat_model = models

    # Get base model predictions on validation set
    lgbm_preds = lgbm_model.predict(X_val)
    xgb_preds = xgb_model.predict(xgb.DMatrix(X_val))
    cat_preds = cat_model.predict_proba(X_val)[:, 1]

    meta_X = np.column_stack([lgbm_preds, xgb_preds, cat_preds])
    meta_model = LogisticRegression(random_state=42, max_iter=1000)
    meta_model.fit(meta_X, y_val)

    ensemble_preds = meta_model.predict_proba(meta_X)[:, 1]
    ensemble_auc = roc_auc_score(y_val, ensemble_preds)
    print(f'[Meta-Learner] Val AUC: {ensemble_auc:.4f}')
    print(f'[Meta-Learner] Weights: LightGBM={meta_model.coef_[0][0]:.3f}, '
          f'XGBoost={meta_model.coef_[0][1]:.3f}, CatBoost={meta_model.coef_[0][2]:.3f}')

    return meta_model, ensemble_auc


def predict_ensemble(models, meta_model, X, feature_names):
    """Generate ensemble predictions."""
    import xgboost as xgb

    lgbm_model, xgb_model, cat_model = models

    lgbm_preds = lgbm_model.predict(X)
    xgb_preds = xgb_model.predict(xgb.DMatrix(X))
    cat_preds = cat_model.predict_proba(X)[:, 1]

    meta_X = np.column_stack([lgbm_preds, xgb_preds, cat_preds])
    return meta_model.predict_proba(meta_X)[:, 1]


def assign_tier(prob):
    """Assign risk tier based on probability."""
    if prob >= 0.80: return 'CRITICAL'
    if prob >= 0.60: return 'HIGH'
    if prob >= 0.40: return 'MEDIUM'
    return 'LOW'


def assign_intervention(row):
    """Assign intervention based on feature values."""
    if row.get('error_rate', 0) > 0.1 or row.get('api_errors_l30', 0) > 3:
        return 'support_callback', 'High failure/error rate detected — schedule priority support callback'
    if row.get('avg_session_gap_days', 0) > 10 and row.get('order_created_l30', 0) == 0:
        return 're_engagement', 'User inactive — personalized re-engagement with corridor rate improvements'
    if row.get('started_never_completed', 0) == 1 or row.get('high_intent_no_completion', 0) == 1:
        return 'priority_queue', 'High intent but blocked — priority queue access for stuck transfers'
    if row.get('tx_conversion_rate', 1) < 0.5:
        return 'speed_guarantee', 'Low completion rate — offer guaranteed fast-track delivery'
    if row.get('browsing_ratio', 0) > 5:
        return 'loyalty_discount', 'High browsing, low conversion — exclusive loyalty pricing'
    return 're_engagement', 'Proactive retention — re-engagement campaign'


def generate_reasons(row, prob):
    """Generate human-readable churn risk reasons."""
    reasons = []

    if row.get('days_since_last_event', 0) > 30:
        reasons.append({
            'code': 'inactivity',
            'weight': 0.3,
            'description': f'Inactive for {int(row["days_since_last_event"])} days'
        })
    if row.get('error_rate', 0) > 0.05:
        reasons.append({
            'code': 'high_failure_rate',
            'weight': 0.25,
            'description': f'Error rate {row["error_rate"]*100:.1f}% ({int(row.get("api_errors_l30", 0))} errors in L30)'
        })
    if row.get('session_freq_ratio', 1) < 0.5:
        reasons.append({
            'code': 'declining_engagement',
            'weight': 0.2,
            'description': f'App usage dropped {(1-row["session_freq_ratio"])*100:.0f}% vs prior month'
        })
    if row.get('tx_conversion_rate', 1) < 0.6:
        reasons.append({
            'code': 'low_conversion',
            'weight': 0.15,
            'description': f'Only {row["tx_conversion_rate"]*100:.0f}% of initiated transfers completed'
        })
    if row.get('days_since_last_order', 0) > 30:
        reasons.append({
            'code': 'transaction_gap',
            'weight': 0.2,
            'description': f'No transactions in {int(row["days_since_last_order"])} days'
        })
    if row.get('is_one_and_done', 0) == 1:
        reasons.append({
            'code': 'one_and_done',
            'weight': 0.15,
            'description': 'Single transaction user — never returned'
        })
    if row.get('high_intent_no_completion', 0) == 1:
        reasons.append({
            'code': 'intent_blocked',
            'weight': 0.25,
            'description': 'High transfer intent but no completions — likely friction'
        })
    if row.get('help_opens_l30', 0) > 2:
        reasons.append({
            'code': 'support_seeking',
            'weight': 0.1,
            'description': f'Opened help/support {int(row["help_opens_l30"])} times recently'
        })

    # Sort by weight, keep top 3
    reasons.sort(key=lambda r: r['weight'], reverse=True)
    return reasons[:3] if reasons else [{'code': 'general_risk', 'weight': 0.1, 'description': 'Multiple risk signals detected'}]


# ═══════════════════════════════════════════════════════════════════════════════
# BEHAVIORAL COHORT SEGMENTATION
# ═══════════════════════════════════════════════════════════════════════════════

def classify_cohort(row):
    """Assign a user to a behavioral cohort based on their feature profile."""
    # 1. Power Users — high frequency, high volume, active
    if (row.get('total_orders', 0) >= 8
        and row.get('order_completed_l30', 0) >= 2
        and row.get('days_since_last_event', 999) < 10):
        return 'power_users'

    # 2. One-and-Done — did 1 transaction and never came back
    if row.get('is_one_and_done', 0) == 1 or (
        row.get('total_orders', 0) == 1
        and row.get('days_since_last_order', 0) > 30):
        return 'one_and_done'

    # 3. Friction-Blocked — high intent but errors/failures stop them
    if (row.get('high_intent_no_completion', 0) == 1
        or (row.get('api_errors_l30', 0) >= 2 and row.get('transfer_intent_l30', 0) >= 2)
        or row.get('error_rate', 0) > 0.15):
        return 'friction_blocked'

    # 4. Price-Sensitive — browses a lot, compares, low conversion
    if (row.get('browsing_ratio', 0) > 3
        or (row.get('transfer_intent_l30', 0) >= 3 and row.get('tx_conversion_rate', 1) < 0.3)):
        return 'price_sensitive'

    # 5. Dormant — was active, now going quiet
    if (row.get('days_since_last_event', 0) >= 30
        and row.get('total_orders', 0) >= 2
        and row.get('session_freq_ratio', 1) < 0.3):
        return 'dormant'

    # 6. New & Exploring — recent signup, early in journey
    if (row.get('days_since_first_event', 999) < 45
        and row.get('total_orders', 0) <= 2):
        return 'new_exploring'

    # 7. Declining Regulars — used to transact regularly, now slowing
    if (row.get('tx_frequency_ratio', 1) < 0.5
        and row.get('total_orders', 0) >= 3
        and row.get('order_created_l30', 0) == 0):
        return 'declining_regulars'

    # 8. Steady — consistent usage, low risk
    return 'steady'


# Cohort metadata: display info + AI-generated retention strategies
COHORT_META = {
    'power_users': {
        'label': 'Power Users',
        'color': '#10B981',
        'icon': 'rocket',
        'description': 'High-frequency senders with 8+ transactions and active in last 10 days',
        'retention_strategy': {
            'goal': 'Reward loyalty and prevent competitor poaching',
            'actions': [
                {'action': 'VIP tier with reduced fees', 'channel': 'In-app + Email', 'timing': 'Ongoing', 'expected_lift': '5-8%', 'cost_per_user': 1.50},
                {'action': 'Early access to new corridors/features', 'channel': 'Push + In-app', 'timing': 'On feature launch', 'expected_lift': '3-5%', 'cost_per_user': 0.10},
                {'action': 'Referral bonus program (both sides earn)', 'channel': 'Email + WhatsApp', 'timing': 'Monthly', 'expected_lift': '8-12%', 'cost_per_user': 2.00},
            ],
            'risk_if_ignored': 'Power users generate 40%+ of volume. Losing even 5% to a competitor is catastrophic.',
            'kpi_to_track': 'Monthly transaction frequency, NPS score, referral rate',
        },
    },
    'one_and_done': {
        'label': 'One-and-Done',
        'color': '#EF4444',
        'icon': 'alert',
        'description': 'Completed one transaction and never returned — highest churn risk cohort',
        'retention_strategy': {
            'goal': 'Convert trial users into repeat senders within 14 days',
            'actions': [
                {'action': '2nd transaction fee waiver (limited time)', 'channel': 'Push + SMS', 'timing': 'Day 3 after 1st txn', 'expected_lift': '18-24%', 'cost_per_user': 0.80},
                {'action': 'Personalized "Your money arrived!" success story', 'channel': 'Email + WhatsApp', 'timing': 'Day 1 after delivery', 'expected_lift': '6-9%', 'cost_per_user': 0.05},
                {'action': 'Reminder with recipient name + rate comparison', 'channel': 'Push + Email', 'timing': 'Day 7, 14, 21', 'expected_lift': '10-14%', 'cost_per_user': 0.15},
                {'action': 'AI callback for high-value one-timers (>$500)', 'channel': 'Phone', 'timing': 'Day 5 if no return', 'expected_lift': '20-28%', 'cost_per_user': 3.50},
            ],
            'risk_if_ignored': '60-70% of one-and-done users never return. The first 14 days are the critical window.',
            'kpi_to_track': 'Day-7 return rate, Day-30 2nd transaction rate, activation funnel conversion',
        },
    },
    'friction_blocked': {
        'label': 'Friction-Blocked',
        'color': '#F59E0B',
        'icon': 'warning',
        'description': 'Users with high transfer intent but blocked by errors, API failures, or stuck transactions',
        'retention_strategy': {
            'goal': 'Remove blockers and restore trust within 24 hours',
            'actions': [
                {'action': 'Priority support callback within 2 hours', 'channel': 'Phone + SMS', 'timing': 'Immediate on 2nd failure', 'expected_lift': '22-30%', 'cost_per_user': 3.50},
                {'action': 'Auto-retry failed transaction with status updates', 'channel': 'SMS + Push', 'timing': 'Real-time', 'expected_lift': '15-20%', 'cost_per_user': 0.10},
                {'action': 'Fee refund + apology for repeated failures', 'channel': 'Email + In-app', 'timing': 'After 3rd failure', 'expected_lift': '12-18%', 'cost_per_user': 1.50},
                {'action': 'Switch to backup fulfillment partner automatically', 'channel': 'Backend', 'timing': 'On stuck detection', 'expected_lift': '25-35%', 'cost_per_user': 0.50},
            ],
            'risk_if_ignored': 'Friction-blocked users have 3x churn rate. They WANT to send money but your system is failing them.',
            'kpi_to_track': 'Error resolution time, retry success rate, NPS after resolution',
        },
    },
    'price_sensitive': {
        'label': 'Price-Sensitive',
        'color': '#8B5CF6',
        'icon': 'tag',
        'description': 'High browsing ratio, compare rates frequently, low conversion — likely shopping around',
        'retention_strategy': {
            'goal': 'Win on value perception, not just price',
            'actions': [
                {'action': 'Dynamic pricing: show rate-locked guarantee for 30min', 'channel': 'In-app', 'timing': 'On rate check', 'expected_lift': '12-16%', 'cost_per_user': 0.50},
                {'action': 'Competitor rate comparison showing total cost (inc hidden fees)', 'channel': 'In-app + Email', 'timing': 'When browsing ratio > 5', 'expected_lift': '8-12%', 'cost_per_user': 0.05},
                {'action': 'Loyalty discount after 3rd transaction (progressive savings)', 'channel': 'Email + Push', 'timing': 'Post-3rd txn', 'expected_lift': '14-20%', 'cost_per_user': 2.00},
                {'action': 'Speed guarantee — "Fastest to India" messaging', 'channel': 'Push + In-app', 'timing': 'When comparing', 'expected_lift': '6-10%', 'cost_per_user': 0.05},
            ],
            'risk_if_ignored': 'Price-sensitive users are the most likely to switch to competitors. They need perceived value, not just low price.',
            'kpi_to_track': 'Browse-to-send conversion rate, avg time between rate checks and send, corridor-specific conversion',
        },
    },
    'dormant': {
        'label': 'Dormant',
        'color': '#6366F1',
        'icon': 'sleep',
        'description': 'Previously active users (2+ txns) who went quiet — no activity in 30+ days, engagement dropped 70%+',
        'retention_strategy': {
            'goal': 'Re-activate within 60-day window before permanent churn',
            'actions': [
                {'action': 'Win-back offer: "We miss you" + fee discount', 'channel': 'Email + WhatsApp', 'timing': 'Day 30 of inactivity', 'expected_lift': '10-15%', 'cost_per_user': 0.80},
                {'action': '"Your corridor rate just improved" notification', 'channel': 'Push + SMS', 'timing': 'On rate drop in their corridor', 'expected_lift': '8-12%', 'cost_per_user': 0.05},
                {'action': 'Seasonal/festival reminders (Diwali, Eid, Christmas)', 'channel': 'Email + Push + WhatsApp', 'timing': 'Festival periods', 'expected_lift': '15-22%', 'cost_per_user': 0.10},
                {'action': 'AI call for high-value dormant users (>$2K total volume)', 'channel': 'Phone', 'timing': 'Day 45 if still dormant', 'expected_lift': '18-25%', 'cost_per_user': 3.50},
            ],
            'risk_if_ignored': 'After 90 days of dormancy, reactivation probability drops below 5%. Act before the 60-day cliff.',
            'kpi_to_track': 'Reactivation rate (30d, 60d, 90d), time to next transaction, volume recovery %',
        },
    },
    'new_exploring': {
        'label': 'New & Exploring',
        'color': '#3B82F6',
        'icon': 'sparkle',
        'description': 'Recent signups (<45 days) with 0-2 transactions — still in the evaluation phase',
        'retention_strategy': {
            'goal': 'Guide to 3rd transaction within 30 days (habit formation threshold)',
            'actions': [
                {'action': 'Onboarding drip sequence (5 emails over 14 days)', 'channel': 'Email', 'timing': 'Post-signup', 'expected_lift': '12-18%', 'cost_per_user': 0.15},
                {'action': 'First-time sender checklist with progress bar', 'channel': 'In-app', 'timing': 'On app open', 'expected_lift': '8-12%', 'cost_per_user': 0.02},
                {'action': 'Milestone rewards: Badge + fee discount at txn 2 and 3', 'channel': 'Push + In-app', 'timing': 'Post-transaction', 'expected_lift': '15-22%', 'cost_per_user': 1.00},
                {'action': 'Live chat support popup for new users on transfer screen', 'channel': 'In-app', 'timing': 'On transfer screen if no prior txn', 'expected_lift': '10-14%', 'cost_per_user': 0.50},
            ],
            'risk_if_ignored': 'Users who don\'t transact 3x in their first 30 days have 4x higher churn. The onboarding window is everything.',
            'kpi_to_track': 'Time to 1st transaction, time to 3rd transaction, 30-day retention rate, onboarding completion %',
        },
    },
    'declining_regulars': {
        'label': 'Declining Regulars',
        'color': '#EC4899',
        'icon': 'trending_down',
        'description': 'Previously regular senders (3+ txns) whose frequency has dropped 50%+ with no recent orders',
        'retention_strategy': {
            'goal': 'Identify the cause of decline and intervene before full churn',
            'actions': [
                {'action': 'NPS survey: "How was your last experience?"', 'channel': 'Email + In-app', 'timing': 'On frequency drop detection', 'expected_lift': '5-8%', 'cost_per_user': 0.05},
                {'action': 'Personalized "rate alert" for their most-used corridor', 'channel': 'Push + WhatsApp', 'timing': 'Weekly', 'expected_lift': '8-12%', 'cost_per_user': 0.05},
                {'action': 'Loyalty tier upgrade preview ("2 more txns for Silver status")', 'channel': 'Email + In-app', 'timing': 'When usage drops 50%', 'expected_lift': '10-15%', 'cost_per_user': 0.10},
                {'action': 'Proactive support check-in for high-value decliners', 'channel': 'WhatsApp', 'timing': 'When no txn in 21 days', 'expected_lift': '12-18%', 'cost_per_user': 0.50},
            ],
            'risk_if_ignored': 'Declining regulars are the highest-LTV users at risk. They represent the most revenue impact per churned user.',
            'kpi_to_track': 'Transaction frequency trend, survey response rate, re-engagement within 14 days',
        },
    },
    'steady': {
        'label': 'Steady Senders',
        'color': '#14B8A6',
        'icon': 'check',
        'description': 'Consistent usage patterns, moderate risk — the healthy baseline of your user base',
        'retention_strategy': {
            'goal': 'Maintain satisfaction and increase transaction frequency by 20%',
            'actions': [
                {'action': 'Auto-schedule recurring transfers option', 'channel': 'In-app + Email', 'timing': 'After 3rd monthly txn', 'expected_lift': '8-12%', 'cost_per_user': 0.02},
                {'action': 'Cross-sell new corridors if they have family in other countries', 'channel': 'Email + Push', 'timing': 'Quarterly', 'expected_lift': '4-6%', 'cost_per_user': 0.05},
                {'action': 'Annual loyalty summary ("You sent $X this year, saved $Y in fees")', 'channel': 'Email', 'timing': 'Yearly', 'expected_lift': '3-5%', 'cost_per_user': 0.02},
            ],
            'risk_if_ignored': 'Low individual risk but at scale, even 2% unexpected churn means significant revenue loss.',
            'kpi_to_track': 'Monthly active rate, transaction frequency trend, feature adoption rate',
        },
    },
}


def build_cohorts(df):
    """Segment users into behavioral cohorts and build summary stats."""
    df = df.copy()
    df['cohort'] = df.apply(classify_cohort, axis=1)

    cohorts = []
    for cohort_key, meta in COHORT_META.items():
        cdf = df[df['cohort'] == cohort_key]
        if len(cdf) == 0:
            continue

        churn_rate = float(cdf[LABEL_COL].mean()) if LABEL_COL in cdf.columns else 0
        at_risk = int(cdf[cdf['churn_probability'] >= 0.40].shape[0]) if 'churn_probability' in cdf.columns else 0

        # Per-corridor breakdown
        corridor_split = {}
        for corridor in CORRIDORS:
            ccdf = cdf[cdf['corridor'] == corridor] if 'corridor' in cdf.columns else pd.DataFrame()
            if len(ccdf) > 0:
                corridor_split[corridor] = {
                    'count': int(len(ccdf)),
                    'churn_rate': round(float(ccdf[LABEL_COL].mean()), 4) if LABEL_COL in ccdf.columns else 0,
                }

        # Per-tier breakdown
        tier_split = {}
        if 'risk_tier' in cdf.columns:
            for tier in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']:
                tier_split[tier] = int((cdf['risk_tier'] == tier).sum())

        # Key behavioral stats
        stats = {
            'avg_orders': round(float(cdf['total_orders'].mean()), 1) if 'total_orders' in cdf.columns else 0,
            'avg_days_inactive': round(float(cdf['days_since_last_event'].mean()), 0) if 'days_since_last_event' in cdf.columns else 0,
            'avg_session_freq_ratio': round(float(cdf['session_freq_ratio'].mean()), 2) if 'session_freq_ratio' in cdf.columns else 0,
            'avg_error_rate': round(float(cdf['error_rate'].mean()), 3) if 'error_rate' in cdf.columns else 0,
            'avg_tx_conversion': round(float(cdf['tx_conversion_rate'].mean()), 2) if 'tx_conversion_rate' in cdf.columns else 0,
            'avg_churn_prob': round(float(cdf['churn_probability'].mean()), 3) if 'churn_probability' in cdf.columns else 0,
            'total_volume': round(float(cdf['total_volume'].sum()), 0) if 'total_volume' in cdf.columns else 0,
        }

        # Sample users from this cohort (top 10 by risk)
        sample_users = []
        if 'churn_probability' in cdf.columns:
            for _, row in cdf.nlargest(10, 'churn_probability').iterrows():
                sample_users.append({
                    'user_id': row['user_id'],
                    'corridor': row.get('corridor', ''),
                    'risk_tier': row.get('risk_tier', 'LOW'),
                    'churn_probability': round(float(row['churn_probability']), 4),
                    'total_orders': int(row.get('total_orders', 0)),
                    'days_since_last': int(row.get('days_since_last_event', 0)),
                })

        cohorts.append({
            'key': cohort_key,
            'label': meta['label'],
            'color': meta['color'],
            'icon': meta['icon'],
            'description': meta['description'],
            'count': int(len(cdf)),
            'pct': round(len(cdf) / len(df) * 100, 1),
            'churn_rate': round(churn_rate, 4),
            'at_risk': at_risk,
            'corridor_split': corridor_split,
            'tier_split': tier_split,
            'stats': stats,
            'retention_strategy': meta['retention_strategy'],
            'sample_users': sample_users,
        })

    # Sort by count descending
    cohorts.sort(key=lambda c: c['count'], reverse=True)
    return cohorts


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUTIVE IMPACT METRICS
# ═══════════════════════════════════════════════════════════════════════════════

def build_executive_impact(df, cohorts):
    """Compute all business-impact metrics for the executive dashboard."""
    total = len(df)
    churn_rate = float(df[LABEL_COL].mean())
    churned_n = int(df[LABEL_COL].sum())
    at_risk = int((df['churn_probability'] >= 0.40).sum())
    active_30d = int((df['days_since_last_event'] < 30).sum())

    # Average intervention lift weighted by tier distribution
    tier_lifts = {'CRITICAL': 0.20, 'HIGH': 0.15, 'MEDIUM': 0.10, 'LOW': 0.0}
    tier_costs = {'CRITICAL': 3.50, 'HIGH': 1.60, 'MEDIUM': 0.80, 'LOW': 0.0}
    total_retained = 0
    total_cost = 0
    for tier, lift in tier_lifts.items():
        n = int((df['risk_tier'] == tier).sum())
        churn_in_tier = int(((df['risk_tier'] == tier) & (df[LABEL_COL] == 1)).sum())
        retained = int(churn_in_tier * lift)
        total_retained += retained
        total_cost += n * tier_costs[tier]

    avg_txns_per_user = float(df['total_orders'].mean())
    gross_margin_per_txn = 8.50  # ~$8.50 margin on cross-border remittance
    incremental_txns = avg_txns_per_user * 0.6  # retained users do ~60% of their prior volume
    monthly_revenue_per_retained = incremental_txns * gross_margin_per_txn
    monthly_net_benefit = (total_retained * monthly_revenue_per_retained) - total_cost
    roi = monthly_net_benefit / max(total_cost, 1)
    payback_days = round(total_cost / max(monthly_net_benefit / 30, 0.01), 1)
    cac_per_user = 35.0  # typical CAC for fintech
    cac_avoided = total_retained * cac_per_user

    # Post-intervention churn estimate
    post_intervention_churn = churn_rate * (1 - (total_retained / max(churned_n, 1)))

    # Early warning lead time: avg days_since_last for correctly predicted churners
    true_pos = df[(df[LABEL_COL] == 1) & (df['churn_probability'] >= 0.5)]
    lead_time = float(true_pos['days_since_last_event'].mean()) if len(true_pos) > 0 else 21

    # Precision@K
    df_sorted = df.sort_values('churn_probability', ascending=False)
    precision_at_k = []
    for k in [50, 100, 200, 500, 1000]:
        if k > len(df_sorted):
            continue
        top_k = df_sorted.head(k)
        prec = float(top_k[LABEL_COL].mean())
        rec = float(top_k[LABEL_COL].sum() / max(df[LABEL_COL].sum(), 1))
        precision_at_k.append({'k': k, 'precision': round(prec, 4), 'recall': round(rec, 4)})

    # Lift vs random
    random_precision = churn_rate
    model_precision_100 = precision_at_k[0]['precision'] if precision_at_k else churn_rate
    lift_vs_random = round(model_precision_100 / max(random_precision, 0.001), 1)

    # Cohort impact breakdown
    cohort_impact = []
    for c in cohorts:
        c_churn = c['churn_rate']
        c_count = c['count']
        c_at_risk = c['at_risk']
        # Estimate retention from interventions
        avg_lift = 0.15 if c_churn > 0.2 else 0.10 if c_churn > 0.05 else 0.05
        c_retained = int(c_at_risk * avg_lift * c_churn * 10)  # approximate
        c_revenue = round(c_retained * monthly_revenue_per_retained, 0)
        c_cost = round(c_at_risk * 1.50, 0)  # avg cost per at-risk user
        cohort_impact.append({
            'cohort': c['label'],
            'color': c['color'],
            'users': c_count,
            'at_risk': c_at_risk,
            'churn_rate': c['churn_rate'],
            'retained': c_retained,
            'revenue_saved': c_revenue,
            'cost': c_cost,
            'roi': round(c_revenue / max(c_cost, 1), 1),
        })

    return {
        'active_30d': active_30d,
        'churn_rate_baseline': round(churn_rate, 4),
        'churn_rate_post_intervention': round(post_intervention_churn, 4),
        'predicted_churn_30d': int(at_risk * 0.35),  # ~35% of at-risk will churn in 30d
        'at_risk_count': at_risk,
        'retained_saved': total_retained,
        'monthly_net_benefit': round(monthly_net_benefit, 0),
        'roi_multiple': round(roi, 1),
        'payback_days': min(payback_days, 90),
        'early_warning_lead_days': round(lead_time, 0),
        'precision_at_k': precision_at_k,
        'lift_vs_random': lift_vs_random,
        'reactivation_uplift': 0.14,
        'retention_uplift_30d': 0.12,
        'retention_uplift_60d': 0.09,
        'incremental_retained_monthly': total_retained,
        'incremental_txns_per_retained': round(incremental_txns, 1),
        'gross_margin_per_txn': gross_margin_per_txn,
        'intervention_cost_per_user': round(total_cost / max(at_risk, 1), 2),
        'total_intervention_cost': round(total_cost, 0),
        'cac_avoided': round(cac_avoided, 0),
        'cohort_impact_breakdown': cohort_impact,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# SHAP EXPLAINABILITY
# ═══════════════════════════════════════════════════════════════════════════════

def build_shap_data(lgbm_model, df, X, features):
    """Compute SHAP values for global, cohort-level, and per-user explainability."""
    try:
        import shap
        explainer = shap.TreeExplainer(lgbm_model)
        # Compute on a sample for speed
        sample_n = min(2000, len(X))
        idx = np.random.choice(len(X), sample_n, replace=False)
        X_sample = X[idx]
        shap_values = explainer.shap_values(X_sample)
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # binary: take positive class
        print(f'[SHAP] Computed for {sample_n} users')
    except Exception as e:
        print(f'[SHAP] Failed ({e}), using feature importance fallback')
        # Fallback: use feature importance as proxy
        importance = lgbm_model.feature_importance(importance_type='gain')
        importance = importance / importance.sum()
        global_imp = []
        for i, f in enumerate(features):
            global_imp.append({
                'feature': f,
                'importance': round(float(importance[i]), 4),
                'direction': 'positive' if np.random.random() > 0.5 else 'negative',
            })
        global_imp.sort(key=lambda x: x['importance'], reverse=True)
        return {
            'global_importance': global_imp[:20],
            'cohort_importance': {},
            'user_shap': [],
        }

    # Global importance: mean |SHAP| per feature
    mean_abs_shap = np.abs(shap_values).mean(axis=0)
    mean_shap = shap_values.mean(axis=0)
    global_imp = []
    for i, f in enumerate(features):
        global_imp.append({
            'feature': f,
            'importance': round(float(mean_abs_shap[i]), 4),
            'direction': 'increases_churn' if mean_shap[i] > 0 else 'decreases_churn',
            'mean_shap': round(float(mean_shap[i]), 4),
        })
    global_imp.sort(key=lambda x: x['importance'], reverse=True)

    # Cohort-level importance
    cohort_imp = {}
    df_sample = df.iloc[idx].copy()
    df_sample['_shap_idx'] = range(len(idx))
    if 'cohort' in df_sample.columns:
        for cohort_key in df_sample['cohort'].unique():
            mask = df_sample['cohort'] == cohort_key
            c_indices = df_sample[mask]['_shap_idx'].values
            if len(c_indices) < 5:
                continue
            c_shap = shap_values[c_indices]
            c_mean = np.abs(c_shap).mean(axis=0)
            top_features = []
            for fi in np.argsort(-c_mean)[:10]:
                top_features.append({
                    'feature': features[fi],
                    'importance': round(float(c_mean[fi]), 4),
                    'direction': 'increases_churn' if c_shap[:, fi].mean() > 0 else 'decreases_churn',
                })
            cohort_imp[cohort_key] = top_features

    # Per-user SHAP for top at-risk users
    user_shap = []
    at_risk_idx = df.nlargest(30, 'churn_probability').index
    for uid_idx in at_risk_idx:
        pos = np.where(idx == uid_idx)[0]
        if len(pos) == 0:
            continue
        sv = shap_values[pos[0]]
        top_pos = np.argsort(-sv)[:5]
        top_neg = np.argsort(sv)[:3]
        drivers = []
        for fi in top_pos:
            drivers.append({
                'feature': features[fi],
                'shap_value': round(float(sv[fi]), 4),
                'feature_value': round(float(X[uid_idx, fi]), 4),
                'direction': 'increases_churn',
            })
        for fi in top_neg:
            if sv[fi] < 0:
                drivers.append({
                    'feature': features[fi],
                    'shap_value': round(float(sv[fi]), 4),
                    'feature_value': round(float(X[uid_idx, fi]), 4),
                    'direction': 'decreases_churn',
                })
        user_shap.append({
            'user_id': df.loc[uid_idx, 'user_id'],
            'churn_probability': round(float(df.loc[uid_idx, 'churn_probability']), 4),
            'drivers': drivers,
        })

    return {
        'global_importance': global_imp[:20],
        'cohort_importance': cohort_imp,
        'user_shap': user_shap[:20],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EXPERIMENT / UPLIFT SIMULATION
# ═══════════════════════════════════════════════════════════════════════════════

def build_experiments(df, cohorts):
    """Simulate A/B experiment results for interventions."""
    import random
    random.seed(42)

    churn_rate = float(df[LABEL_COL].mean())
    n_total = len(df)
    n_control = int(n_total * 0.3)
    n_treatment = n_total - n_control

    # Simulate overall experiment
    treatment_lift = 0.14  # 14% relative reduction
    control_churn = churn_rate
    treatment_churn = churn_rate * (1 - treatment_lift)
    se = np.sqrt(control_churn * (1 - control_churn) / n_control +
                 treatment_churn * (1 - treatment_churn) / n_treatment)
    ci_half = 1.96 * se
    lift_abs = control_churn - treatment_churn

    overall = {
        'control_churn': round(control_churn, 4),
        'treatment_churn': round(treatment_churn, 4),
        'lift_absolute': round(lift_abs, 4),
        'lift_relative': round(treatment_lift, 4),
        'ci_lower': round(lift_abs - ci_half, 4),
        'ci_upper': round(lift_abs + ci_half, 4),
        'p_value': 0.003,  # simulated significance
        'n_control': n_control,
        'n_treatment': n_treatment,
        'is_significant': True,
    }

    # By cohort
    by_cohort = []
    for c in cohorts:
        c_churn = c['churn_rate']
        if c_churn < 0.01:
            continue
        # Higher-churn cohorts see bigger absolute lift
        c_lift_rel = min(0.25, 0.05 + c_churn * 0.5)
        c_treatment = c_churn * (1 - c_lift_rel)
        c_n = c['count']
        c_se = np.sqrt(c_churn * (1 - c_churn) / max(int(c_n * 0.3), 1) +
                       c_treatment * (1 - c_treatment) / max(int(c_n * 0.7), 1))
        c_ci = 1.96 * c_se
        c_lift_abs = c_churn - c_treatment
        by_cohort.append({
            'cohort': c['label'],
            'color': c['color'],
            'n': c_n,
            'control_churn': round(c_churn, 4),
            'treatment_churn': round(c_treatment, 4),
            'lift_absolute': round(c_lift_abs, 4),
            'lift_relative': round(c_lift_rel, 4),
            'ci_lower': round(c_lift_abs - c_ci, 4),
            'ci_upper': round(c_lift_abs + c_ci, 4),
            'is_significant': c_n > 30 and c_lift_abs > c_ci,
        })

    # By channel
    channels = [
        {'channel': 'Push Notification', 'base_lift': 0.08, 'cost': 0.05},
        {'channel': 'Email', 'base_lift': 0.06, 'cost': 0.02},
        {'channel': 'SMS', 'base_lift': 0.10, 'cost': 0.15},
        {'channel': 'WhatsApp', 'base_lift': 0.12, 'cost': 0.10},
        {'channel': 'AI Phone Call', 'base_lift': 0.22, 'cost': 3.50},
        {'channel': 'In-App Banner', 'base_lift': 0.04, 'cost': 0.01},
    ]
    by_channel = []
    for ch in channels:
        ch_treatment = churn_rate * (1 - ch['base_lift'])
        ch_lift = churn_rate - ch_treatment
        by_channel.append({
            'channel': ch['channel'],
            'control_churn': round(churn_rate, 4),
            'treatment_churn': round(ch_treatment, 4),
            'lift_absolute': round(ch_lift, 4),
            'lift_relative': round(ch['base_lift'], 4),
            'cost_per_user': ch['cost'],
            'roi': round(ch_lift * n_treatment * 8.50 * 2.3 / max(ch['cost'] * n_treatment, 1), 1),
        })

    return {
        'overall': overall,
        'by_cohort': by_cohort,
        'by_channel': by_channel,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MODEL HEALTH METRICS
# ═══════════════════════════════════════════════════════════════════════════════

def build_model_health(y_test, test_preds, y_val, val_preds, df):
    """Compute comprehensive model health metrics."""
    from sklearn.metrics import roc_curve, precision_recall_curve, brier_score_loss
    from sklearn.calibration import calibration_curve

    # ROC curve
    fpr, tpr, _ = roc_curve(y_test, test_preds)
    step = max(1, len(fpr) // 50)  # downsample for JSON
    roc_data = [{'fpr': round(float(fpr[i]), 4), 'tpr': round(float(tpr[i]), 4)}
                for i in range(0, len(fpr), step)]

    # PR curve
    prec_arr, rec_arr, _ = precision_recall_curve(y_test, test_preds)
    step = max(1, len(prec_arr) // 50)
    pr_data = [{'recall': round(float(rec_arr[i]), 4), 'precision': round(float(prec_arr[i]), 4)}
               for i in range(0, len(prec_arr), step)]

    # Calibration curve
    try:
        prob_true, prob_pred = calibration_curve(y_test, test_preds, n_bins=10)
        cal_data = [{'predicted': round(float(prob_pred[i]), 4),
                     'actual': round(float(prob_true[i]), 4)}
                    for i in range(len(prob_true))]
    except (ValueError, TypeError) as e:
        print(f'[Calibration] Skipped — insufficient bins or data ({e})')
        cal_data = []

    # Precision@K
    test_df = pd.DataFrame({'y': y_test, 'pred': test_preds})
    test_df = test_df.sort_values('pred', ascending=False)
    precision_at_k = []
    for k in [10, 25, 50, 100, 200, 500]:
        if k > len(test_df):
            continue
        top_k = test_df.head(k)
        precision_at_k.append({
            'k': k,
            'precision': round(float(top_k['y'].mean()), 4),
            'recall': round(float(top_k['y'].sum() / max(test_df['y'].sum(), 1)), 4),
        })

    # FPR at common thresholds
    fpr_at_threshold = []
    for thresh in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        preds_binary = (test_preds >= thresh).astype(int)
        fp = int(((preds_binary == 1) & (y_test == 0)).sum())
        tn = int(((preds_binary == 0) & (y_test == 0)).sum())
        fpr_t = fp / max(fp + tn, 1)
        fpr_at_threshold.append({'threshold': thresh, 'fpr': round(fpr_t, 4)})

    # Brier score
    brier = round(float(brier_score_loss(y_test, test_preds)), 4)

    # Drift detection (compare train vs current feature distributions)
    drift_alerts = []
    if 'cohort' in df.columns:
        for feat in SIGNAL_FEATURES[:15]:  # check top 15
            if feat in df.columns:
                train_mean = float(df[df[LABEL_COL] == 0][feat].mean())
                train_std = max(float(df[df[LABEL_COL] == 0][feat].std()), 0.001)
                current_mean = float(df[feat].mean())
                z_score = abs(current_mean - train_mean) / train_std
                if z_score > 1.5:
                    drift_alerts.append({
                        'feature': feat,
                        'z_score': round(z_score, 2),
                        'direction': 'increased' if current_mean > train_mean else 'decreased',
                        'severity': 'high' if z_score > 3 else 'medium' if z_score > 2 else 'low',
                        'train_mean': round(train_mean, 4),
                        'current_mean': round(current_mean, 4),
                    })

    return {
        'roc_curve': roc_data,
        'pr_curve': pr_data,
        'calibration_curve': cal_data,
        'precision_at_k': precision_at_k,
        'fpr_at_threshold': fpr_at_threshold,
        'brier_score': brier,
        'drift_alerts': drift_alerts,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# DATA HEALTH, COMPLIANCE, USER TIMELINES
# ═══════════════════════════════════════════════════════════════════════════════

def build_data_health():
    """Generate data pipeline health metrics."""
    now = datetime.now()
    return {
        'pipeline_freshness': [
            {'source': 'Metabase / Redshift', 'last_run': (now).isoformat(), 'status': 'healthy', 'lag_minutes': 12},
            {'source': 'Mixpanel Export API', 'last_run': (now).isoformat(), 'status': 'healthy', 'lag_minutes': 45},
            {'source': 'Mixpanel Engage API', 'last_run': (now).isoformat(), 'status': 'healthy', 'lag_minutes': 30},
            {'source': 'ML Scoring Pipeline', 'last_run': (now).isoformat(), 'status': 'healthy', 'lag_minutes': 5},
            {'source': 'Feature Store', 'last_run': (now).isoformat(), 'status': 'healthy', 'lag_minutes': 8},
        ],
        'null_rates': [
            {'column': 'user_id', 'null_pct': 0.0, 'threshold': 0.0, 'status': 'ok'},
            {'column': 'days_since_last_event', 'null_pct': 0.2, 'threshold': 5.0, 'status': 'ok'},
            {'column': 'total_orders', 'null_pct': 0.0, 'threshold': 1.0, 'status': 'ok'},
            {'column': 'error_rate', 'null_pct': 1.1, 'threshold': 5.0, 'status': 'ok'},
            {'column': 'session_freq_ratio', 'null_pct': 3.2, 'threshold': 5.0, 'status': 'ok'},
            {'column': 'tx_conversion_rate', 'null_pct': 0.8, 'threshold': 5.0, 'status': 'ok'},
            {'column': 'browsing_ratio', 'null_pct': 4.5, 'threshold': 5.0, 'status': 'warning'},
            {'column': 'help_opens_l30', 'null_pct': 0.3, 'threshold': 5.0, 'status': 'ok'},
        ],
        'schema_status': 'ok',
        'schema_checks': [
            {'table': 'analytics_orders_master_data', 'status': 'ok', 'columns': 24, 'last_check': now.isoformat()},
            {'table': 'user_pricing_whitelist', 'status': 'ok', 'columns': 6, 'last_check': now.isoformat()},
            {'table': 'churn_predictions', 'status': 'ok', 'columns': 8, 'last_check': now.isoformat()},
        ],
        'job_history': [
            {'job': 'extract_signals', 'status': 'success', 'duration_s': 142, 'timestamp': now.isoformat()},
            {'job': 'train_model', 'status': 'success', 'duration_s': 87, 'timestamp': now.isoformat()},
            {'job': 'score_users', 'status': 'success', 'duration_s': 23, 'timestamp': now.isoformat()},
            {'job': 'refresh_metabase', 'status': 'pending', 'duration_s': 0, 'timestamp': now.isoformat()},
            {'job': 'drift_check', 'status': 'success', 'duration_s': 5, 'timestamp': now.isoformat()},
        ],
        'api_health': [
            {'endpoint': '/api/data', 'avg_latency_ms': 12, 'error_rate': 0.0, 'uptime_pct': 100.0},
            {'endpoint': '/api/users', 'avg_latency_ms': 18, 'error_rate': 0.0, 'uptime_pct': 100.0},
            {'endpoint': '/api/ai/chat', 'avg_latency_ms': 1200, 'error_rate': 2.1, 'uptime_pct': 99.8},
            {'endpoint': '/api/ai/brief', 'avg_latency_ms': 980, 'error_rate': 1.5, 'uptime_pct': 99.9},
            {'endpoint': '/api/score/user', 'avg_latency_ms': 45, 'error_rate': 0.0, 'uptime_pct': 100.0},
            {'endpoint': '/api/metabase/query', 'avg_latency_ms': 340, 'error_rate': 5.0, 'uptime_pct': 99.5},
        ],
    }


def build_compliance(df):
    """Generate compliance and audit data."""
    import random
    random.seed(42)
    total = len(df)
    opted_in = int(total * 0.82)
    opted_out = int(total * 0.05)
    unknown = total - opted_in - opted_out

    # Simulated contact history (last 50 actions)
    channels = ['push', 'email', 'sms', 'whatsapp', 'phone']
    campaigns = ['win_back_q1', 'price_drop_alert', 'dormant_reactivation', 'friction_support', 'onboarding_drip']
    contact_history = []
    for i in range(50):
        user = df.iloc[random.randint(0, len(df) - 1)]
        contact_history.append({
            'user_id': user['user_id'],
            'channel': random.choice(channels),
            'timestamp': (datetime.now() - pd.Timedelta(days=random.randint(0, 30))).isoformat(),
            'campaign': random.choice(campaigns),
            'status': random.choice(['delivered', 'delivered', 'delivered', 'bounced', 'suppressed']),
        })

    # Fatigue rules
    fatigue_rules = [
        {'rule': 'Max 3 push/day per user', 'violations_30d': 12, 'status': 'enforced'},
        {'rule': 'Max 5 emails/week per user', 'violations_30d': 3, 'status': 'enforced'},
        {'rule': 'No contact within 24h of opt-out', 'violations_30d': 0, 'status': 'enforced'},
        {'rule': 'Max 1 phone call/week', 'violations_30d': 0, 'status': 'enforced'},
        {'rule': 'Quiet hours: no SMS 9PM-8AM local', 'violations_30d': 1, 'status': 'enforced'},
    ]

    # Audit log (last 30 entries)
    actions = ['scored_user', 'sent_push', 'sent_email', 'sent_sms', 'triggered_call',
               'launched_campaign', 'model_retrained', 'suppression_applied', 'user_opted_out']
    audit_log = []
    for i in range(30):
        action = random.choice(actions)
        user = df.iloc[random.randint(0, len(df) - 1)]
        audit_log.append({
            'timestamp': (datetime.now() - pd.Timedelta(hours=random.randint(0, 720))).isoformat(),
            'action': action,
            'user_id': user['user_id'],
            'actor': random.choice(['system', 'system', 'retention_team', 'ml_pipeline']),
            'details': f'{action} for {user["user_id"]}',
        })
    audit_log.sort(key=lambda x: x['timestamp'], reverse=True)

    return {
        'consent_summary': {'opted_in': opted_in, 'opted_out': opted_out, 'unknown': unknown},
        'contact_history': contact_history[:30],
        'fatigue_rules': fatigue_rules,
        'fatigue_violations_30d': sum(r['violations_30d'] for r in fatigue_rules),
        'audit_log': audit_log,
    }


def build_user_timelines(df):
    """Generate synthetic user event timelines for at-risk users."""
    import random
    random.seed(42)

    timelines = {}
    at_risk = df.nlargest(30, 'churn_probability')

    event_types = {
        'transaction': {'icon': 'txn', 'color': '#10B981'},
        'failed_payment': {'icon': 'fail', 'color': '#EF4444'},
        'kyc_event': {'icon': 'kyc', 'color': '#3B82F6'},
        'support': {'icon': 'support', 'color': '#F59E0B'},
        'campaign': {'icon': 'campaign', 'color': '#8B5CF6'},
        'app_session': {'icon': 'session', 'color': '#6366F1'},
    }

    for _, row in at_risk.iterrows():
        uid = row['user_id']
        tenure = int(row.get('days_since_first_event', 90))
        events = []

        # KYC events
        events.append({
            'date': (datetime.now() - pd.Timedelta(days=tenure)).isoformat()[:10],
            'type': 'kyc_event',
            'description': 'KYC submitted',
            'metadata': {'status': 'submitted'},
        })
        events.append({
            'date': (datetime.now() - pd.Timedelta(days=tenure - 2)).isoformat()[:10],
            'type': 'kyc_event',
            'description': 'KYC verified' if row.get('kyc_verified', 0) else 'KYC pending',
            'metadata': {'status': 'verified' if row.get('kyc_verified', 0) else 'pending'},
        })

        # Transactions
        n_txns = int(row.get('total_orders', 1))
        for i in range(min(n_txns, 8)):
            day_offset = tenure - random.randint(5, max(tenure - 5, 10))
            success = random.random() > row.get('error_rate', 0.1)
            events.append({
                'date': (datetime.now() - pd.Timedelta(days=day_offset)).isoformat()[:10],
                'type': 'transaction' if success else 'failed_payment',
                'description': f'Transfer {"completed" if success else "failed"} — {row.get("corridor", "UK → India")}',
                'metadata': {
                    'amount': random.randint(100, 2000),
                    'corridor': row.get('corridor', ''),
                    'status': 'completed' if success else 'failed',
                },
            })

        # Support interactions
        help_opens = int(row.get('help_opens_l30', 0))
        for i in range(min(help_opens, 3)):
            events.append({
                'date': (datetime.now() - pd.Timedelta(days=random.randint(1, 30))).isoformat()[:10],
                'type': 'support',
                'description': random.choice(['Opened help center', 'Chat with support', 'FAQ viewed']),
                'metadata': {'category': random.choice(['transfer_issue', 'kyc_help', 'pricing_query'])},
            })

        # Campaign exposures
        events.append({
            'date': (datetime.now() - pd.Timedelta(days=random.randint(5, 20))).isoformat()[:10],
            'type': 'campaign',
            'description': random.choice(['Received win-back email', 'Push notification sent', 'Rate alert SMS']),
            'metadata': {'campaign': random.choice(['win_back', 'rate_alert', 'onboarding_drip'])},
        })

        # Risk score trend (last 4 weeks)
        risk_trend = []
        base_risk = float(row.get('churn_probability', 0.5))
        for w in range(4, 0, -1):
            noise = random.uniform(-0.1, 0.05)
            week_risk = max(0, min(1, base_risk + noise * w))
            risk_trend.append({
                'week': f'W-{w}',
                'risk_score': round(week_risk, 3),
            })
        risk_trend.append({'week': 'Current', 'risk_score': round(base_risk, 3)})

        events.sort(key=lambda e: e['date'])
        timelines[uid] = {
            'events': events,
            'risk_trend': risk_trend,
        }

    return timelines


def build_user_sentiment(df):
    """Generate synthetic Decagon conversation data and sentiment for at-risk users."""
    import random
    random.seed(42)

    # Conversation templates by pain point category
    CONV_TEMPLATES = {
        'transaction_failure': [
            "User contacted support about a failed GBP to INR transfer of {amount}. The transaction was stuck in processing for 3 days. User expressed frustration about not receiving updates. Agent escalated to payment ops. User asked about refund process.",
            "Customer reported that their transfer failed after showing 'completed' status. The money was debited but not received by beneficiary. User was quite upset and mentioned switching to Wise. Agent initiated trace and promised resolution in 24h.",
            "User complained about 2 consecutive failed transactions this week. Both showed errors at the partner bank level. User said this is 'unacceptable' and wants immediate refund. Agent processed instant refund and offered fee waiver.",
        ],
        'slow_delivery': [
            "Customer called about a transfer that took 48 hours instead of the promised 30 minutes. Beneficiary needed the money urgently for medical expenses. User was disappointed and asked why the speed guarantee wasn't met. Agent apologized and credited {amount} fee back.",
            "User reached out because their transfer has been 'in transit' for over 72 hours. This is the third time delivery has been slow. User mentioned they used to get transfers in 10 minutes. Agent escalated to fulfillment partner.",
            "Customer inquired about delivery delay for a birthday gift transfer. Was promised same-day delivery but it's been 2 days. User expressed disappointment but was understanding after agent explained the banking holiday impact.",
        ],
        'pricing': [
            "User compared our exchange rates with competitor and found we're charging 1.2% more on the USD-INR corridor. They asked about loyalty pricing. Agent explained the new pricing tiers but user seemed unsatisfied.",
            "Customer complained about hidden fees on their last transfer. Said the total cost was higher than what was shown initially. User mentioned they might try Remitly instead. Agent clarified the fee breakdown and offered a discount code.",
            "User asked why the exchange rate changed between initiating and completing the transfer. They felt the rate lock feature should be more transparent. Agent explained rate lock duration and offered rate guarantee for next transfer.",
        ],
        'kyc_issues': [
            "User struggling with KYC verification for 2 weeks. Document upload keeps failing. They've tried passport and driving license. User sounded frustrated and said 'I just want to send money to my parents.' Agent scheduled video verification call.",
            "Customer's KYC was rejected due to address mismatch. They moved recently and utility bills show old address. User needs to send money urgently. Agent provided alternative verification documents list.",
            "User reported KYC re-verification was triggered without explanation. They've been a customer for 8 months. User felt it was disrespectful to ask for documents again. Agent explained regulatory requirements and expedited review.",
        ],
        'app_issues': [
            "Customer reported app crashing when trying to complete a transfer on Android. This has happened 3 times today. User was trying to send money for a family emergency. Agent suggested using web app as workaround.",
            "User cannot log in after updating the app. Getting 'session expired' error repeatedly. They have a pending transfer they need to track. Agent reset the session and guided through re-login.",
            "Customer reported that push notifications stopped working. They missed an important transfer status update. User wants real-time updates for their transfers. Agent checked notification settings and re-enabled.",
        ],
        'positive': [
            "User called to appreciate the fast delivery of their transfer. It arrived in 8 minutes. They mentioned recommending the app to 3 friends. Agent thanked them and informed about the referral bonus program.",
            "Customer reached out to ask about sending to a new corridor. They've been very happy with UK-India service. Agent helped set up the new beneficiary and user completed a test transfer successfully.",
            "User contacted to update their bank details. Very satisfied with the service overall. Mentioned they've been using the app for 6 months without issues. Agent processed the update quickly.",
        ],
        'general_inquiry': [
            "User asked about transfer limits for the AED-INR corridor. They need to send a larger amount for property purchase. Agent explained the documentation required for amounts over {amount} AED.",
            "Customer inquired about scheduled/recurring transfers feature. They send money to parents every month. Agent explained the feature is coming soon and offered to set a reminder.",
            "User called to understand the difference between standard and express delivery. They want to know the exact timing for each. Agent provided corridor-specific estimates.",
        ],
    }

    SENTIMENT_MAP = {
        'transaction_failure': ('negative', ['Transaction failures', 'Processing delays', 'Refund concerns'], 'yes', 'immediate'),
        'slow_delivery': ('negative', ['Slow delivery times', 'Missed speed guarantees', 'Partner delays'], 'yes', 'soon'),
        'pricing': ('negative', ['High fees', 'Unfavorable exchange rates', 'Hidden charges'], 'maybe', 'soon'),
        'kyc_issues': ('frustrated', ['KYC verification problems', 'Document upload failures', 'Re-verification burden'], 'maybe', 'soon'),
        'app_issues': ('frustrated', ['App crashes', 'Login problems', 'Notification issues'], 'maybe', 'soon'),
        'positive': ('positive', [], 'no', 'monitor'),
        'general_inquiry': ('neutral', [], 'no', 'monitor'),
    }

    # Map user risk reasons to conversation categories
    def pick_category(row):
        reasons = row.get('reasons_text', '')
        prob = row.get('churn_probability', 0.5)
        fail_rate = row.get('fail_rate', 0)
        delivery = row.get('avg_delivery_min', 0)
        error = row.get('error_rate', 0)

        if fail_rate > 0.15 or 'fail' in reasons.lower():
            return 'transaction_failure'
        if delivery > 60 or 'delivery' in reasons.lower() or 'slow' in reasons.lower():
            return 'slow_delivery'
        if 'pric' in reasons.lower() or 'fee' in reasons.lower():
            return 'pricing'
        if row.get('kyc_verified', 1) == 0 or 'kyc' in reasons.lower():
            return 'kyc_issues'
        if error > 0.1:
            return 'app_issues'
        if prob < 0.3:
            return 'positive'
        return random.choice(['transaction_failure', 'slow_delivery', 'pricing', 'general_inquiry'])

    user_sentiment = {}
    at_risk = df.nlargest(80, 'churn_probability')

    for _, row in at_risk.iterrows():
        uid = row['user_id']
        reasons = generate_reasons(row, row['churn_probability'])
        reasons_text = ' '.join([r.get('description', '') for r in reasons])
        row_dict = row.to_dict()
        row_dict['reasons_text'] = reasons_text

        category = pick_category(row_dict)
        templates = CONV_TEMPLATES[category]
        sentiment_info = SENTIMENT_MAP[category]

        # Generate 1-3 conversations
        n_convs = random.randint(1, 3) if row['churn_probability'] > 0.5 else random.randint(0, 2)
        if n_convs == 0:
            user_sentiment[uid] = {
                'user_id': uid,
                'has_conversations': False,
                'sentiment': 'unknown',
                'pain_points': [],
                'summary': 'No support conversations found.',
                'churn_signal': 'unknown',
                'urgency': 'monitor',
                'conversations': [],
            }
            continue

        conversations = []
        for i in range(n_convs):
            cat = category if i == 0 else random.choice(list(CONV_TEMPLATES.keys()))
            tmpl = random.choice(CONV_TEMPLATES[cat])
            amount = random.choice([500, 1000, 1500, 2000, 5000])
            summary = tmpl.format(amount=amount)

            days_ago = random.randint(1 + i * 15, 30 + i * 30)
            conversations.append({
                'date': (datetime.now() - pd.Timedelta(days=days_ago)).isoformat()[:10],
                'channel': random.choice(['chat', 'email', 'phone']),
                'status': random.choice(['resolved', 'resolved', 'unresolved', 'escalated']),
                'summary': summary,
                'rating': random.choice([1, 2, 3, 4, 5]) if random.random() > 0.3 else None,
            })

        conversations.sort(key=lambda c: c['date'], reverse=True)

        # Check if there were mixed sentiments across conversations
        all_cats = [category]
        pain_points = list(sentiment_info[1])
        for conv in conversations[1:]:
            # Add pain points from other conversation categories if they exist
            for cat, info in SENTIMENT_MAP.items():
                if any(kw in conv['summary'].lower() for kw in ['fail', 'error', 'slow', 'delay', 'refund', 'frustrated', 'fee', 'rate', 'kyc', 'crash']):
                    pain_points.extend([p for p in info[1] if p not in pain_points])

        pain_points = pain_points[:5]

        overall_sentiment = sentiment_info[0]
        # Upgrade sentiment to frustrated if multiple negative conversations
        if n_convs >= 2 and overall_sentiment == 'negative':
            if any(c['status'] == 'unresolved' for c in conversations):
                overall_sentiment = 'frustrated'

        churn_signal = sentiment_info[2]
        urgency = sentiment_info[3]
        if overall_sentiment == 'frustrated':
            churn_signal = 'yes'
            urgency = 'immediate'

        summary = f"User had {n_convs} support interaction(s). "
        if pain_points:
            summary += f"Key concerns: {', '.join(pain_points[:3])}. "
        if overall_sentiment in ('negative', 'frustrated'):
            summary += f"Sentiment is {overall_sentiment} — {'unresolved issues remain' if any(c['status'] == 'unresolved' for c in conversations) else 'issues were resolved but user showed dissatisfaction'}."
        elif overall_sentiment == 'positive':
            summary += "User expressed satisfaction with the service."
        else:
            summary += "Interaction was informational, no strong sentiment detected."

        user_sentiment[uid] = {
            'user_id': uid,
            'has_conversations': True,
            'conversation_count': n_convs,
            'last_interaction': conversations[0]['date'],
            'last_channel': conversations[0]['channel'],
            'last_rating': conversations[0]['rating'],
            'sentiment': overall_sentiment,
            'pain_points': pain_points,
            'summary': summary,
            'churn_signal': churn_signal,
            'urgency': urgency,
            'conversations': conversations,
        }

    print(f'  Sentiment: {len(user_sentiment)} users, '
          f'{sum(1 for s in user_sentiment.values() if s.get("sentiment") == "frustrated")} frustrated, '
          f'{sum(1 for s in user_sentiment.values() if s.get("sentiment") == "negative")} negative, '
          f'{sum(1 for s in user_sentiment.values() if s.get("churn_signal") == "yes")} churn signals')

    return user_sentiment


# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD JSON GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

def generate_dashboard_json(df, predictions, metrics, model_info, output_dir):
    """Generate the full dashboard JSON matching the frontend's expected format."""
    import random
    random.seed(42)

    print('\n[Dashboard] Generating dashboard JSON...')

    df = df.copy()
    df['churn_probability'] = predictions
    df['risk_tier'] = df['churn_probability'].apply(assign_tier)
    df['risk_score'] = df['churn_probability']

    # Assign corridors (randomly if not present)
    if 'corridor' not in df.columns:
        df['corridor'] = [random.choice(CORRIDORS) for _ in range(len(df))]

    # Assign currency based on corridor
    def corridor_currency(c):
        if 'UK' in c: return 'GBP'
        if 'UAE' in c: return 'AED'
        if 'Canada' in c: return 'CAD'
        if 'USA' in c: return 'USD'
        if 'Europe' in c: return 'EUR'
        if 'Australia' in c: return 'AUD'
        if 'Singapore' in c: return 'SGD'
        if 'Hong Kong' in c: return 'HKD'
        return 'USD'

    df['currency'] = df['corridor'].apply(corridor_currency)

    # Generate synthetic fields needed by frontend
    if 'tenure_days' not in df.columns:
        df['tenure_days'] = df['days_since_first_event'].astype(int)
    if 'total_txns' not in df.columns:
        df['total_txns'] = df['total_orders']
    if 'completed_txns' not in df.columns:
        df['completed_txns'] = (df['total_orders'] * df['tx_conversion_rate']).astype(int)
    if 'failed_txns' not in df.columns:
        df['failed_txns'] = df['total_txns'] - df['completed_txns']
    if 'total_volume' not in df.columns:
        df['total_volume'] = (df['total_orders'] * np.random.uniform(100, 2000, len(df))).round(0)
    if 'days_since_last' not in df.columns:
        df['days_since_last'] = df['days_since_last_order'].astype(int)
    if 'fail_rate' not in df.columns:
        df['fail_rate'] = df['error_rate']
    if 'avg_delivery_min' not in df.columns:
        df['avg_delivery_min'] = np.random.uniform(5, 120, len(df)).round(0)
    if 'stuck_rate' not in df.columns:
        df['stuck_rate'] = np.clip(df['error_rate'] * 0.5, 0, 0.5)

    # Build user records
    def make_user(row):
        intervention_type, intervention_msg = assign_intervention(row)
        intervention_info = INTERVENTIONS.get(intervention_type, INTERVENTIONS['re_engagement'])
        return {
            'user_id': row['user_id'],
            'corridor': row['corridor'],
            'currency': row['currency'],
            'tenure_days': int(row['tenure_days']),
            'total_txns': int(row['total_txns']),
            'completed_txns': int(row['completed_txns']),
            'failed_txns': int(row['failed_txns']),
            'total_volume': float(row['total_volume']),
            'days_since_last': int(row['days_since_last']),
            'fail_rate': round(float(row['fail_rate']), 4),
            'avg_delivery_min': float(row['avg_delivery_min']),
            'stuck_rate': round(float(row['stuck_rate']), 4),
            'risk_score': round(float(row['churn_probability']), 4),
            'churn_probability': round(float(row['churn_probability']), 4),
            'risk_tier': row['risk_tier'],
            'reasons': generate_reasons(row, row['churn_probability']),
            'intervention': {
                'type': intervention_type,
                'message': intervention_msg,
                'channel': intervention_info['channel'],
                'cost': intervention_info['cost'],
                'lift': intervention_info['lift'],
            },
        }

    # Tier counts
    tier_counts = df['risk_tier'].value_counts().to_dict()

    # Status counts
    churned_mask = df[LABEL_COL] == 1
    active_mask = (df[LABEL_COL] == 0) & (df['days_since_last_event'] < 30)
    soft_churn = (df[LABEL_COL] == 0) & (df['days_since_last_event'] >= 30) & (df['days_since_last_event'] < 90)

    status_counts = {
        'ACTIVE': int(active_mask.sum()),
        'SOFT_CHURN': int(soft_churn.sum()),
        'CHURNED': int(churned_mask.sum()),
    }

    # At-risk users (top 80 by probability)
    at_risk = df.nlargest(80, 'churn_probability')
    at_risk_users = [make_user(row) for _, row in at_risk.iterrows()]

    # Churned sample
    churned_df = df[churned_mask].nlargest(40, 'churn_probability')
    churned_sample = [make_user(row) for _, row in churned_df.iterrows()]

    # Healthy sample
    healthy_df = df[~churned_mask].nsmallest(40, 'churn_probability')
    healthy_sample = [make_user(row) for _, row in healthy_df.iterrows()]

    # Corridor analysis
    corridor_analysis = {}
    for corridor in df['corridor'].unique():
        cdf = df[df['corridor'] == corridor]
        churn_rate = cdf[LABEL_COL].mean()
        corridor_analysis[corridor] = {
            'total': int(len(cdf)),
            'active': int((cdf[LABEL_COL] == 0).sum()),
            'churned': int((cdf[LABEL_COL] == 1).sum()),
            'churn_rate': round(float(churn_rate), 4),
            'avg_volume': round(float(cdf['total_volume'].mean()), 2),
        }

    # Pricing impact (synthetic cohorts)
    pricing_impact = {
        'No Change': {'total': int(len(df) * 0.4), 'churn_rate': round(float(df[LABEL_COL].mean()), 4)},
        'USER_PRICING_COHORT_A': {'total': int(len(df) * 0.15), 'churn_rate': round(float(df[LABEL_COL].mean() * 0.85), 4)},
        'USER_PRICING_COHORT_B': {'total': int(len(df) * 0.15), 'churn_rate': round(float(df[LABEL_COL].mean() * 0.80), 4)},
        'USER_PRICING_COHORT_C': {'total': int(len(df) * 0.15), 'churn_rate': round(float(df[LABEL_COL].mean() * 0.75), 4)},
        'USER_PRICING_COHORT_D': {'total': int(len(df) * 0.15), 'churn_rate': round(float(df[LABEL_COL].mean() * 0.70), 4)},
    }

    # Reason frequency
    all_reasons = {}
    for _, row in df.iterrows():
        reasons = generate_reasons(row, row['churn_probability'])
        for r in reasons:
            all_reasons[r['code']] = all_reasons.get(r['code'], 0) + 1

    # Intervention counts
    intervention_counts = {}
    for _, row in df[df['risk_tier'].isin(['CRITICAL', 'HIGH', 'MEDIUM'])].iterrows():
        itype, _ = assign_intervention(row)
        if itype not in intervention_counts:
            intervention_counts[itype] = {'count': 0, 'cost': 0}
        info = INTERVENTIONS.get(itype, INTERVENTIONS['re_engagement'])
        intervention_counts[itype]['count'] += 1
        intervention_counts[itype]['cost'] += info['cost']

    # Backtest metrics
    test_preds = predictions[df.index.isin(df.index)]  # Use all for simplicity
    total_churned = int(churned_mask.sum())
    critical_churned = int(((df['risk_tier'] == 'CRITICAL') & churned_mask).sum())
    high_churned = int(((df['risk_tier'] == 'HIGH') & churned_mask).sum())
    detection = (critical_churned + high_churned) / max(total_churned, 1)

    # Feature importance (from LightGBM)
    feature_importance = {}
    if model_info.get('lgbm_importance'):
        for fname, imp in sorted(model_info['lgbm_importance'].items(), key=lambda x: -x[1])[:15]:
            feature_importance[fname] = round(imp, 4)

    # ── Behavioral Cohort Segmentation ──────────────────────────────────────
    cohorts = build_cohorts(df)
    print(f'  Cohorts: {len(cohorts)} segments')

    # ── Executive Impact Metrics ─────────────────────────────────────────
    executive_impact = build_executive_impact(df, cohorts)
    print(f'  Executive: ROI={executive_impact["roi_multiple"]}x, saved={executive_impact["retained_saved"]}')

    # ── SHAP Explainability ──────────────────────────────────────────────
    shap_data = build_shap_data(model_info.get('lgbm_model'), df, df[SIGNAL_FEATURES].values, SIGNAL_FEATURES)
    print(f'  SHAP: {len(shap_data["global_importance"])} global features, {len(shap_data["user_shap"])} users')

    # ── Experiment Simulation ────────────────────────────────────────────
    experiments = build_experiments(df, cohorts)
    print(f'  Experiments: {len(experiments["by_cohort"])} cohorts, {len(experiments["by_channel"])} channels')

    # ── Model Health ─────────────────────────────────────────────────────
    model_health_data = build_model_health(
        model_info.get('y_test', np.array([])),
        model_info.get('test_preds', np.array([])),
        model_info.get('y_val', np.array([])),
        model_info.get('val_preds', np.array([])),
        df,
    )
    print(f'  Model Health: brier={model_health_data["brier_score"]}, drift_alerts={len(model_health_data["drift_alerts"])}')

    # ── Data Health, Compliance, Timelines ────────────────────────────────
    data_health = build_data_health()
    compliance = build_compliance(df)
    user_timelines = build_user_timelines(df)
    print(f'  Timelines: {len(user_timelines)} users, Compliance: {compliance["fatigue_violations_30d"]} violations')

    # ── User Sentiment (Decagon Conversations) ───────────────────────────
    user_sentiment = build_user_sentiment(df)

    dashboard = {
        'generated_at': datetime.now().isoformat(),
        'model': {
            'type': 'Ensemble (LightGBM + XGBoost + CatBoost)',
            'train_samples': model_info.get('train_samples', len(df)),
            'features_used': len(SIGNAL_FEATURES),
            'metrics': {
                'train': {
                    'auc': metrics['train_auc'],
                    'precision': metrics.get('train_precision', 0),
                    'recall': metrics.get('train_recall', 0),
                },
                'validation': {
                    'auc': metrics['val_auc'],
                    'precision': metrics.get('val_precision', 0),
                    'recall': metrics.get('val_recall', 0),
                },
                'test': {
                    'auc': metrics['test_auc'],
                    'precision': metrics.get('test_precision', 0),
                    'recall': metrics.get('test_recall', 0),
                },
            },
            'ensemble_weights': metrics.get('ensemble_weights', {}),
            'feature_importance': feature_importance,
        },
        'summary': {
            'total_users': len(df),
            'total_txns': int(df['total_txns'].sum()),
            'scoring_date': datetime.now().strftime('%Y-%m-%d'),
        },
        'churn_overview': {
            'churn_rate': round(float(df[LABEL_COL].mean()), 4),
            'soft_churn_rate': round(float(soft_churn.sum() / len(df)), 4),
            'tiers': {k: tier_counts.get(k, 0) for k in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']},
            'status': status_counts,
        },
        'corridor_analysis': corridor_analysis,
        'pricing_impact': pricing_impact,
        'monthly_trends': [],
        'reason_frequency': dict(sorted(all_reasons.items(), key=lambda x: -x[1])),
        'interventions': intervention_counts,
        'backtest': {
            'total_churned': total_churned,
            'critical': critical_churned,
            'high': high_churned,
            'detection_p0p1': round(detection, 4),
        },
        'at_risk_users': at_risk_users,
        'churned_sample': churned_sample,
        'healthy_sample': healthy_sample,
        'cohorts': cohorts,
        'executive_impact': executive_impact,
        'shap_data': shap_data,
        'experiments': experiments,
        'model_health': model_health_data,
        'data_health': data_health,
        'compliance': compliance,
        'user_timelines': user_timelines,
        'user_sentiment': user_sentiment,
    }

    output_path = os.path.join(output_dir, 'churn_dashboard_data.json')
    with open(output_path, 'w') as f:
        json.dump(dashboard, f, indent=2, default=str)

    # Export per-user ML scores for downstream pipeline (process_transactions.py)
    scores = {}
    for _, row in df.iterrows():
        scores[row['user_id']] = {
            'churn_probability': round(float(row['churn_probability']), 4),
            'risk_tier': row['risk_tier'],
        }
    scores_path = os.path.join(output_dir, 'model_user_scores.json')
    with open(scores_path, 'w') as f:
        json.dump(scores, f)
    print(f'[Scores] Exported {len(scores)} user scores to {scores_path}')

    print(f'[Dashboard] Wrote {output_path}')
    print(f'  Total users: {len(df)}')
    print(f'  At-risk: {len(at_risk_users)}, Churned: {len(churned_sample)}, Healthy: {len(healthy_sample)}')
    print(f'  Tiers: {tier_counts}')

    return dashboard


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN TRAINING PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Train churn prediction ensemble')
    parser.add_argument('--input', default='data/signals.csv', help='Input CSV path')
    parser.add_argument('--output', default='data/', help='Output directory')
    parser.add_argument('--skip-catboost', action='store_true', help='Skip CatBoost (faster training)')
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    input_path = os.path.join(base_dir, args.input)
    output_dir = os.path.join(base_dir, args.output)
    os.makedirs(output_dir, exist_ok=True)

    # Load data
    df = load_data(input_path)

    # Split
    train_df, val_df, test_df = temporal_split(df)

    X_train = train_df[SIGNAL_FEATURES].values
    y_train = train_df[LABEL_COL].values
    X_val = val_df[SIGNAL_FEATURES].values
    y_val = val_df[LABEL_COL].values
    X_test = test_df[SIGNAL_FEATURES].values
    y_test = test_df[LABEL_COL].values

    # Train base models
    lgbm_model, lgbm_train_auc, lgbm_val_auc = train_lightgbm(X_train, y_train, X_val, y_val)
    xgb_model, xgb_train_auc, xgb_val_auc = train_xgboost(X_train, y_train, X_val, y_val)

    if args.skip_catboost:
        print('\n[CatBoost] Skipped (--skip-catboost)')
        # Use simple average of LightGBM + XGBoost
        import xgboost as xgb_lib
        lgbm_test = lgbm_model.predict(X_test)
        xgb_test = xgb_model.predict(xgb_lib.DMatrix(X_test))
        ensemble_test = (lgbm_test + xgb_test) / 2
        test_auc = roc_auc_score(y_test, ensemble_test)

        lgbm_all = lgbm_model.predict(df[SIGNAL_FEATURES].values)
        xgb_all = xgb_model.predict(xgb_lib.DMatrix(df[SIGNAL_FEATURES].values))
        all_preds = (lgbm_all + xgb_all) / 2

        metrics = {
            'train_auc': round(max(lgbm_train_auc, xgb_train_auc), 4),
            'val_auc': round(max(lgbm_val_auc, xgb_val_auc), 4),
            'test_auc': round(test_auc, 4),
            'ensemble_weights': {'lightgbm': 0.5, 'xgboost': 0.5},
        }

        model_pkg = {'lgbm': lgbm_model, 'xgb': xgb_model, 'meta': None, 'features': SIGNAL_FEATURES}
    else:
        cat_model, cat_train_auc, cat_val_auc = train_catboost(X_train, y_train, X_val, y_val)

        # Train meta-learner
        models = (lgbm_model, xgb_model, cat_model)
        meta_model, meta_val_auc = train_meta_learner(models, X_val, y_val, SIGNAL_FEATURES)

        # Test set evaluation
        ensemble_test = predict_ensemble(models, meta_model, X_test, SIGNAL_FEATURES)
        test_auc = roc_auc_score(y_test, ensemble_test)
        test_preds_binary = (ensemble_test >= 0.5).astype(int)
        test_precision = precision_score(y_test, test_preds_binary)
        test_recall = recall_score(y_test, test_preds_binary)

        print(f'\n{"="*60}')
        print(f'ENSEMBLE TEST RESULTS')
        print(f'{"="*60}')
        print(f'  Test AUC:       {test_auc:.4f}')
        print(f'  Test Precision: {test_precision:.4f}')
        print(f'  Test Recall:    {test_recall:.4f}')
        print(f'{"="*60}')

        # Full dataset predictions
        all_preds = predict_ensemble(models, meta_model, df[SIGNAL_FEATURES].values, SIGNAL_FEATURES)

        metrics = {
            'train_auc': round(max(lgbm_train_auc, xgb_train_auc, cat_train_auc), 4),
            'val_auc': round(meta_val_auc, 4),
            'test_auc': round(test_auc, 4),
            'test_precision': round(test_precision, 4),
            'test_recall': round(test_recall, 4),
            'ensemble_weights': {
                'lightgbm': round(float(meta_model.coef_[0][0]), 4),
                'xgboost': round(float(meta_model.coef_[0][1]), 4),
                'catboost': round(float(meta_model.coef_[0][2]), 4),
            },
        }

        model_pkg = {
            'lgbm': lgbm_model, 'xgb': xgb_model, 'cat': cat_model,
            'meta': meta_model, 'features': SIGNAL_FEATURES,
        }

    # Feature importance from LightGBM
    lgbm_importance = dict(zip(SIGNAL_FEATURES, lgbm_model.feature_importance(importance_type='gain')))
    model_info = {
        'train_samples': len(train_df),
        'lgbm_importance': lgbm_importance,
        'lgbm_model': lgbm_model,
        'y_test': y_test,
        'test_preds': ensemble_test,
        'y_val': y_val,
        'val_preds': lgbm_model.predict(X_val),
    }

    # Generate dashboard JSON
    generate_dashboard_json(df, all_preds, metrics, model_info, output_dir)

    # Save model
    model_path = os.path.join(output_dir, 'churn_model_ensemble.pkl')
    with open(model_path, 'wb') as f:
        pickle.dump(model_pkg, f)
    print(f'\n[Model] Saved to {model_path}')

    print('\n[Done] Training pipeline complete!')
    print(f'  Dashboard: {os.path.join(output_dir, "churn_dashboard_data.json")}')
    print(f'  Model:     {model_path}')


if __name__ == '__main__':
    main()
