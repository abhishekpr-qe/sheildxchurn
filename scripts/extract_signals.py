#!/usr/bin/env python3
"""
Aspora Churn Intelligence — Mixpanel Signal Extraction Pipeline
Extracts 43 features from Mixpanel Engage + Export APIs per SIGNALS.md spec.

Usage:
  export MIXPANEL_API_SECRET=your_secret
  export MIXPANEL_PROJECT_ID=2826019
  python3 scripts/extract_signals.py --from-date 2025-06-01 --to-date 2026-02-20 --output data/signals.csv

Features extracted:
  - 9 user property features (Engage API)
  - 7 engagement signals (Export API)
  - 9 transaction signals
  - 3 transfer funnel signals
  - 4 friction signals
  - 3 screen journey signals
  - 4 timing signals
  - 4 feature interactions
"""

import os
import sys
import json
import csv
import argparse
import base64
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from collections import defaultdict

# ── Configuration ───────────────────────────────────────────────────────────────
MIXPANEL_SECRET     = os.environ.get('MIXPANEL_API_SECRET', '')
MIXPANEL_PROJECT_ID = os.environ.get('MIXPANEL_PROJECT_ID', '2826019')
ENGAGE_URL          = 'https://mixpanel.com/api/2.0/engage'
EXPORT_URL          = 'https://data.mixpanel.com/api/2.0/export'

# Observation window for churn labeling (60 days forward from scoring date)
CHURN_WINDOW_DAYS = 60

# Events to export
EXPORT_EVENTS = [
    'Screen loaded', 'ORDER_CREATED', 'ORDER_COMPLETED', 'send now click',
    'bifrost api failed', 'bifrost api timeout exception',
    'home_screen_loaded', 'transfer_screen_loaded',
    'review_transfer_screen_loaded', 'help_and_support_screen_loaded',
    'chat_with_us_clicked', '$ae_session',
]

# Onboarding step ordering for ordinal encoding
ONBOARDING_STEPS = {
    'signup_screen':    0,
    'phone_verify':     1,
    'personal_details': 2,
    'kyc_upload':       3,
    'kyc_review':       4,
    'kyc_verified':     5,
}


def auth_header():
    """Create Basic auth header for Mixpanel API."""
    token = base64.b64encode(f'{MIXPANEL_SECRET}:'.encode()).decode()
    return {'Authorization': f'Basic {token}'}


def fetch_json(url, headers=None):
    """Fetch URL and return parsed JSON."""
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def fetch_streaming(url, headers=None):
    """Fetch streaming JSONL response, yield parsed dicts."""
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req) as resp:
        for line in resp:
            line = line.decode().strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


# ═══════════════════════════════════════════════════════════════════════════════
# ENGAGE API — User Property Features (9 features)
# ═══════════════════════════════════════════════════════════════════════════════

def pull_engage_features():
    """
    Pull user properties from Mixpanel Engage API.
    Returns dict: user_id -> {feature: value, ...}
    """
    print('[Engage API] Pulling user properties...')
    users = {}
    page = 0
    session_id = None

    while True:
        params = {'page': page}
        if session_id:
            params['session_id'] = session_id

        url = f'{ENGAGE_URL}?{urllib.parse.urlencode(params)}'
        data = fetch_json(url, headers=auth_header())

        session_id = data.get('session_id')
        results = data.get('results', [])

        if not results:
            break

        now = datetime.utcnow()

        for entry in results:
            uid = entry.get('$distinct_id', '')
            props = entry.get('$properties', {})

            # Parse $last_seen
            last_seen_str = props.get('$last_seen', '')
            if last_seen_str:
                try:
                    last_seen = datetime.fromisoformat(last_seen_str.replace('Z', '+00:00').replace('+00:00', ''))
                    days_since = (now - last_seen).days
                except Exception:
                    days_since = 999
            else:
                days_since = 999

            # KYC status one-hot
            kyc_status = (props.get('user_kyc_status', '') or '').lower()

            users[uid] = {
                'days_since_last_seen':   days_since,
                'total_app_sessions':     props.get('$ae_total_app_sessions', 0) or 0,
                'push_enabled':           1 if props.get('push_notification') else 0,
                'is_referred':            1 if props.get('is_referred') else 0,
                'kyc_verified':           1 if kyc_status == 'verified' else 0,
                'kyc_rejected':           1 if kyc_status == 'rejected' else 0,
                'kyc_blocked':            1 if kyc_status == 'blocked' else 0,
                'kyc_re_required':        1 if kyc_status == 're_required' else 0,
                'kyc_pending':            1 if kyc_status == 'pending' else 0,
            }

        page += 1
        print(f'  Page {page}: {len(results)} users (total: {len(users)})')

        if len(results) < 1000:
            break

    print(f'[Engage API] Done: {len(users)} users')
    return users


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORT API — Event-Derived Features (34 features)
# ═══════════════════════════════════════════════════════════════════════════════

def pull_export_events(from_date, to_date):
    """
    Pull events from Mixpanel Export API.
    Returns dict: user_id -> list of event dicts
    """
    print(f'[Export API] Pulling events from {from_date} to {to_date}...')

    params = urllib.parse.urlencode({
        'from_date': from_date,
        'to_date': to_date,
        'event': json.dumps(EXPORT_EVENTS),
    })
    url = f'{EXPORT_URL}?{params}'

    user_events = defaultdict(list)
    count = 0

    for event in fetch_streaming(url, headers=auth_header()):
        uid = event.get('properties', {}).get('distinct_id', '')
        if not uid:
            continue

        user_events[uid].append({
            'event':  event.get('event', ''),
            'time':   event.get('properties', {}).get('time', 0),
            'props':  event.get('properties', {}),
        })
        count += 1
        if count % 100000 == 0:
            print(f'  Processed {count:,} events ({len(user_events):,} users)')

    print(f'[Export API] Done: {count:,} events, {len(user_events):,} users')
    return user_events


def compute_event_features(user_events, scoring_date_str):
    """
    Compute 34 event-derived features from raw events.
    Returns dict: user_id -> {feature: value, ...}
    """
    print('[Features] Computing event-derived features...')
    scoring_date = datetime.strptime(scoring_date_str, '%Y-%m-%d')
    l30_start = (scoring_date - timedelta(days=30)).timestamp()
    l90_start = (scoring_date - timedelta(days=90)).timestamp()
    prior30_start = (scoring_date - timedelta(days=60)).timestamp()
    scoring_ts = scoring_date.timestamp()

    features = {}

    for uid, events in user_events.items():
        # Sort by time
        events.sort(key=lambda e: e['time'])

        # Initialize counters
        app_opens_l30 = 0
        app_opens_prior30 = 0
        unique_screens = set()
        screen_depths = []
        session_times = []
        order_created_l30 = 0
        order_created_l90 = 0
        order_completed_l30 = 0
        total_orders = 0
        last_order_time = 0
        send_clicks_l30 = 0
        transfer_intent_l30 = 0
        funnel_reach_l30 = 0
        api_errors_l30 = 0
        api_timeouts_l30 = 0
        help_opens_l30 = 0
        total_events = 0
        first_event_time = events[0]['time'] if events else 0
        last_event_time = 0
        onboarding_step = 0
        orders_completed = 0
        chat_clicks = 0

        for e in events:
            t = e['time']
            ev = e['event']
            last_event_time = max(last_event_time, t)
            total_events += 1

            # Engagement
            if ev in ('home_screen_loaded', '$ae_session'):
                session_times.append(t)
                if t >= l30_start:
                    app_opens_l30 += 1
                if prior30_start <= t < l30_start:
                    app_opens_prior30 += 1

            if ev == 'Screen loaded':
                screen_name = e['props'].get('screen_name', '')
                unique_screens.add(screen_name)
                # Track onboarding steps
                step_val = ONBOARDING_STEPS.get(screen_name, -1)
                if step_val > onboarding_step:
                    onboarding_step = step_val

            # Transactions
            if ev == 'ORDER_CREATED':
                total_orders += 1
                if t >= l30_start:
                    order_created_l30 += 1
                if t >= l90_start:
                    order_created_l90 += 1
                last_order_time = max(last_order_time, t)

            if ev == 'ORDER_COMPLETED':
                orders_completed += 1
                if t >= l30_start:
                    order_completed_l30 += 1

            if ev == 'send now click':
                if t >= l30_start:
                    send_clicks_l30 += 1

            # Transfer funnel
            if ev == 'transfer_screen_loaded' and t >= l30_start:
                transfer_intent_l30 += 1
            if ev == 'review_transfer_screen_loaded' and t >= l30_start:
                funnel_reach_l30 += 1

            # Friction
            if ev == 'bifrost api failed' and t >= l30_start:
                api_errors_l30 += 1
            if ev == 'bifrost api timeout exception' and t >= l30_start:
                api_timeouts_l30 += 1
            if ev in ('help_and_support_screen_loaded', 'chat_with_us_clicked') and t >= l30_start:
                help_opens_l30 += 1
            if ev == 'chat_with_us_clicked':
                chat_clicks += 1

        # Compute derived features
        days_since_first = (scoring_ts - first_event_time) / 86400 if first_event_time else 0
        days_since_last_event = (scoring_ts - last_event_time) / 86400 if last_event_time else 999
        days_since_last_order = (scoring_ts - last_order_time) / 86400 if last_order_time else 999

        # Session frequency ratio (L30 / prior30)
        session_freq_ratio = app_opens_l30 / max(app_opens_prior30, 1)

        # Average session gap
        session_gaps = []
        for i in range(1, len(session_times)):
            gap = (session_times[i] - session_times[i-1]) / 86400
            session_gaps.append(gap)
        avg_session_gap = sum(session_gaps) / max(len(session_gaps), 1) if session_gaps else 999

        # Transaction metrics
        tx_freq_ratio = order_created_l30 / max(order_created_l90 - order_created_l30, 1) if order_created_l90 > order_created_l30 else (order_created_l30 if order_created_l30 > 0 else 0)
        tx_conversion_rate = orders_completed / max(total_orders, 1)
        started_never_completed = 1 if total_orders > 0 and orders_completed == 0 else 0
        days_to_first_order = 0
        if first_event_time and last_order_time:
            # Find first order time
            first_order = min((e['time'] for e in events if e['event'] == 'ORDER_CREATED'), default=0)
            if first_order:
                days_to_first_order = (first_order - first_event_time) / 86400

        # Browsing ratio
        screen_views = len([e for e in events if e['event'] == 'Screen loaded'])
        browsing_ratio = screen_views / max(total_orders + 1, 1)

        # Error rate
        total_api_calls = api_errors_l30 + api_timeouts_l30 + order_created_l30 + order_completed_l30
        error_rate = (api_errors_l30 + api_timeouts_l30) / max(total_api_calls, 1)

        # Regularity score (coefficient of variation of order gaps)
        order_times = sorted([e['time'] for e in events if e['event'] == 'ORDER_CREATED'])
        order_gaps = [(order_times[i] - order_times[i-1]) / 86400 for i in range(1, len(order_times))]
        if len(order_gaps) >= 2:
            mean_gap = sum(order_gaps) / len(order_gaps)
            std_gap = (sum((g - mean_gap)**2 for g in order_gaps) / len(order_gaps)) ** 0.5
            tx_regularity = 1 - min(std_gap / max(mean_gap, 1), 1)
        else:
            tx_regularity = 0

        is_one_and_done = 1 if total_orders == 1 and days_since_last_order > 30 else 0

        # Screen depth average
        screen_depth_avg = len(unique_screens) / max(app_opens_l30, 1)

        # Feature interactions
        kyc_completed_no_order = 0  # Will be merged with engage data
        errors_before_first_order = 0
        if first_event_time:
            first_order_t = min((e['time'] for e in events if e['event'] == 'ORDER_CREATED'), default=scoring_ts)
            errors_before_first_order = len([
                e for e in events
                if e['event'] in ('bifrost api failed', 'bifrost api timeout exception')
                and e['time'] < first_order_t
            ])

        high_intent_no_completion = 1 if transfer_intent_l30 >= 3 and order_completed_l30 == 0 else 0
        single_session_deep_funnel = 1 if len(session_times) <= 2 and funnel_reach_l30 > 0 else 0

        features[uid] = {
            # Engagement (7)
            'app_opens_l30':           app_opens_l30,
            'app_opens_prior30':       app_opens_prior30,
            'session_freq_ratio':      round(session_freq_ratio, 4),
            'unique_screens_visited':  len(unique_screens),
            'screen_depth_avg':        round(screen_depth_avg, 4),
            'days_since_last_event':   round(days_since_last_event, 1),
            'avg_session_gap_days':    round(avg_session_gap, 2),

            # Transactions (9)
            'order_created_l30':       order_created_l30,
            'order_created_l90':       order_created_l90,
            'order_completed_l30':     order_completed_l30,
            'total_orders':            total_orders,
            'days_since_last_order':   round(days_since_last_order, 1),
            'tx_frequency_ratio':      round(tx_freq_ratio, 4),
            'send_clicks_l30':         send_clicks_l30,
            'tx_conversion_rate':      round(tx_conversion_rate, 4),
            'started_never_completed': started_never_completed,

            # Transfer funnel (3)
            'transfer_intent_l30':     transfer_intent_l30,
            'funnel_reach_l30':        funnel_reach_l30,
            'browsing_ratio':          round(browsing_ratio, 2),

            # Friction (4)
            'api_errors_l30':          api_errors_l30,
            'api_timeouts_l30':        api_timeouts_l30,
            'error_rate':              round(error_rate, 4),
            'help_opens_l30':          help_opens_l30,

            # Screen journey (3)
            'onboarding_step_reached': onboarding_step,
            'kyc_completed':           1 if onboarding_step >= 5 else 0,
            'onboarding_completed':    1 if onboarding_step >= 5 and total_orders > 0 else 0,

            # Timing (4)
            'days_since_first_event':  round(days_since_first, 1),
            'days_to_first_order':     round(days_to_first_order, 1),
            'tx_regularity_score':     round(tx_regularity, 4),
            'is_one_and_done':         is_one_and_done,

            # Feature interactions (4)
            'kyc_completed_no_order':       0,  # Updated after merge
            'errors_before_first_order':    errors_before_first_order,
            'high_intent_no_completion':     high_intent_no_completion,
            'single_session_deep_funnel':    single_session_deep_funnel,
        }

    print(f'[Features] Computed features for {len(features):,} users')
    return features


# ═══════════════════════════════════════════════════════════════════════════════
# CHURN LABELING
# ═══════════════════════════════════════════════════════════════════════════════

def compute_churn_labels(user_events, scoring_date_str):
    """
    Label users as churned (1) or not (0) based on 60-day forward window.
    Churn = no ORDER_CREATED in the 60 days after scoring date.
    """
    scoring_date = datetime.strptime(scoring_date_str, '%Y-%m-%d')
    window_start = scoring_date.timestamp()
    window_end = (scoring_date + timedelta(days=CHURN_WINDOW_DAYS)).timestamp()

    labels = {}
    for uid, events in user_events.items():
        has_order = any(
            e['event'] == 'ORDER_CREATED' and window_start <= e['time'] <= window_end
            for e in events
        )
        labels[uid] = 0 if has_order else 1

    churned = sum(labels.values())
    print(f'[Labels] {churned}/{len(labels)} churned ({churned/max(len(labels),1)*100:.1f}%)')
    return labels


# ═══════════════════════════════════════════════════════════════════════════════
# MERGE & OUTPUT
# ═══════════════════════════════════════════════════════════════════════════════

def merge_and_output(engage_features, event_features, labels, output_path):
    """Merge all features and output CSV."""
    all_uids = set(engage_features.keys()) | set(event_features.keys())
    print(f'[Merge] {len(all_uids)} total users')

    # Build feature columns
    engage_cols = list(next(iter(engage_features.values())).keys()) if engage_features else []
    event_cols = list(next(iter(event_features.values())).keys()) if event_features else []
    all_cols = ['user_id'] + engage_cols + event_cols + ['churn_label']

    rows = []
    for uid in all_uids:
        eng = engage_features.get(uid, {})
        evt = event_features.get(uid, {})

        # Fix feature interaction: kyc_completed_no_order
        kyc_verified = eng.get('kyc_verified', 0)
        total_orders = evt.get('total_orders', 0)
        if 'kyc_completed_no_order' in evt:
            evt['kyc_completed_no_order'] = 1 if kyc_verified == 1 and total_orders == 0 else 0

        row = {'user_id': uid}
        for col in engage_cols:
            row[col] = eng.get(col, 0)
        for col in event_cols:
            row[col] = evt.get(col, 0)
        row['churn_label'] = labels.get(uid, -1)
        rows.append(row)

    # Population filters
    filtered = [
        r for r in rows
        if r.get('kyc_verified', 0) == 1
        and r.get('total_orders', 0) >= 1
        and r.get('days_since_first_event', 0) >= 30
    ]
    print(f'[Filter] {len(filtered)} users after filters (kyc_verified, total_orders>=1, tenure>=30d)')

    # Write CSV
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=all_cols)
        writer.writeheader()
        writer.writerows(filtered)

    print(f'[Output] Wrote {len(filtered)} rows to {output_path}')
    return filtered


# ═══════════════════════════════════════════════════════════════════════════════
# DEMO MODE — Generate synthetic signals when Mixpanel isn't configured
# ═══════════════════════════════════════════════════════════════════════════════

def generate_demo_signals(output_path, n_users=5000):
    """Generate synthetic signal data for demo/development purposes."""
    import random
    random.seed(42)

    print(f'[Demo Mode] Generating {n_users} synthetic users...')

    engage_cols = [
        'days_since_last_seen', 'total_app_sessions', 'push_enabled',
        'is_referred', 'kyc_verified', 'kyc_rejected', 'kyc_blocked',
        'kyc_re_required', 'kyc_pending',
    ]
    event_cols = [
        'app_opens_l30', 'app_opens_prior30', 'session_freq_ratio',
        'unique_screens_visited', 'screen_depth_avg', 'days_since_last_event',
        'avg_session_gap_days', 'order_created_l30', 'order_created_l90',
        'order_completed_l30', 'total_orders', 'days_since_last_order',
        'tx_frequency_ratio', 'send_clicks_l30', 'tx_conversion_rate',
        'started_never_completed', 'transfer_intent_l30', 'funnel_reach_l30',
        'browsing_ratio', 'api_errors_l30', 'api_timeouts_l30', 'error_rate',
        'help_opens_l30', 'onboarding_step_reached', 'kyc_completed',
        'onboarding_completed', 'days_since_first_event', 'days_to_first_order',
        'tx_regularity_score', 'is_one_and_done', 'kyc_completed_no_order',
        'errors_before_first_order', 'high_intent_no_completion',
        'single_session_deep_funnel',
    ]

    all_cols = ['user_id'] + engage_cols + event_cols + ['churn_label']

    rows = []
    for i in range(n_users):
        is_churner = random.random() < 0.15

        # Generate correlated features
        app_opens = max(0, int(random.gauss(3 if is_churner else 12, 5)))
        total_orders = max(1, int(random.gauss(2 if is_churner else 6, 3)))
        days_inactive = max(0, int(random.gauss(45 if is_churner else 8, 20)))

        row = {
            'user_id': f'user_{i:06d}',
            'days_since_last_seen':   max(0, int(random.gauss(30 if is_churner else 5, 15))),
            'total_app_sessions':     max(0, int(random.gauss(10 if is_churner else 40, 15))),
            'push_enabled':           random.choice([0, 1]),
            'is_referred':            1 if random.random() < 0.3 else 0,
            'kyc_verified':           1,
            'kyc_rejected':           0,
            'kyc_blocked':            0,
            'kyc_re_required':        0,
            'kyc_pending':            0,
            'app_opens_l30':          app_opens,
            'app_opens_prior30':      max(0, int(random.gauss(8 if is_churner else 10, 4))),
            'session_freq_ratio':     round(max(0, random.gauss(0.4 if is_churner else 1.2, 0.5)), 4),
            'unique_screens_visited': max(1, int(random.gauss(4 if is_churner else 8, 3))),
            'screen_depth_avg':       round(max(0.1, random.gauss(1.5 if is_churner else 3.0, 1.0)), 4),
            'days_since_last_event':  days_inactive,
            'avg_session_gap_days':   round(max(0.1, random.gauss(7 if is_churner else 2, 3)), 2),
            'order_created_l30':      max(0, int(random.gauss(0.5 if is_churner else 2, 1.5))),
            'order_created_l90':      max(0, int(random.gauss(1 if is_churner else 5, 2))),
            'order_completed_l30':    max(0, int(random.gauss(0.3 if is_churner else 1.8, 1))),
            'total_orders':           total_orders,
            'days_since_last_order':  max(0, int(random.gauss(50 if is_churner else 12, 20))),
            'tx_frequency_ratio':     round(max(0, random.gauss(0.3 if is_churner else 1.0, 0.4)), 4),
            'send_clicks_l30':        max(0, int(random.gauss(1 if is_churner else 3, 2))),
            'tx_conversion_rate':     round(max(0, min(1, random.gauss(0.5 if is_churner else 0.85, 0.2))), 4),
            'started_never_completed': 1 if is_churner and random.random() < 0.3 else 0,
            'transfer_intent_l30':    max(0, int(random.gauss(1 if is_churner else 3, 2))),
            'funnel_reach_l30':       max(0, int(random.gauss(0.5 if is_churner else 2, 1.5))),
            'browsing_ratio':         round(max(0, random.gauss(8 if is_churner else 3, 4)), 2),
            'api_errors_l30':         max(0, int(random.gauss(2 if is_churner else 0.3, 1.5))),
            'api_timeouts_l30':       max(0, int(random.gauss(1 if is_churner else 0.1, 0.8))),
            'error_rate':             round(max(0, min(1, random.gauss(0.15 if is_churner else 0.03, 0.1))), 4),
            'help_opens_l30':         max(0, int(random.gauss(2 if is_churner else 0.5, 1.5))),
            'onboarding_step_reached': 5,
            'kyc_completed':          1,
            'onboarding_completed':   1,
            'days_since_first_event': max(30, int(random.gauss(120, 50))),
            'days_to_first_order':    max(0, int(random.gauss(10 if is_churner else 3, 5))),
            'tx_regularity_score':    round(max(0, min(1, random.gauss(0.2 if is_churner else 0.6, 0.25))), 4),
            'is_one_and_done':        1 if is_churner and total_orders == 1 and random.random() < 0.4 else 0,
            'kyc_completed_no_order': 0,
            'errors_before_first_order': max(0, int(random.gauss(1 if is_churner else 0.2, 1))),
            'high_intent_no_completion': 1 if is_churner and random.random() < 0.2 else 0,
            'single_session_deep_funnel': 1 if random.random() < 0.05 else 0,
            'churn_label':            1 if is_churner else 0,
        }
        rows.append(row)

    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=all_cols)
        writer.writeheader()
        writer.writerows(rows)

    churned = sum(1 for r in rows if r['churn_label'] == 1)
    print(f'[Demo] Wrote {len(rows)} users ({churned} churned, {churned/len(rows)*100:.1f}%) to {output_path}')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Extract Mixpanel signals for churn prediction')
    parser.add_argument('--from-date', default='2025-06-01', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--to-date', default='2026-02-20', help='End date (YYYY-MM-DD)')
    parser.add_argument('--scoring-date', default='2025-12-20', help='Scoring/observation date')
    parser.add_argument('--output', default='data/signals.csv', help='Output CSV path')
    parser.add_argument('--demo', action='store_true', help='Generate synthetic data (no API needed)')
    parser.add_argument('--demo-users', type=int, default=5000, help='Number of synthetic users')
    args = parser.parse_args()

    output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    if args.demo or not MIXPANEL_SECRET:
        if not MIXPANEL_SECRET:
            print('[Warning] MIXPANEL_API_SECRET not set — running in demo mode')
        generate_demo_signals(output_path, args.demo_users)
        return

    # Full pipeline
    engage_features = pull_engage_features()
    user_events = pull_export_events(args.from_date, args.to_date)
    event_features = compute_event_features(user_events, args.scoring_date)
    labels = compute_churn_labels(user_events, args.scoring_date)
    merge_and_output(engage_features, event_features, labels, output_path)


if __name__ == '__main__':
    main()
