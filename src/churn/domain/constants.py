"""Single source of truth for domain constants used across Python scripts and Node.js."""
from __future__ import annotations

# All 43 Mixpanel-derived features from SIGNALS.md
SIGNAL_FEATURES = [
    # Engage API (9)
    'days_since_last_seen', 'total_app_sessions', 'push_enabled',
    'is_referred', 'kyc_verified', 'kyc_rejected', 'kyc_blocked',
    'kyc_re_required', 'kyc_pending',
    # Engagement (7)
    'app_opens_l30', 'app_opens_prior30', 'session_freq_ratio',
    'unique_screens_visited', 'screen_depth_avg', 'days_since_last_event',
    'avg_session_gap_days',
    # Transactions (9)
    'order_created_l30', 'order_created_l90', 'order_completed_l30',
    'total_orders', 'days_since_last_order', 'tx_frequency_ratio',
    'send_clicks_l30', 'tx_conversion_rate', 'started_never_completed',
    # Transfer funnel (3)
    'transfer_intent_l30', 'funnel_reach_l30', 'browsing_ratio',
    # Friction (4)
    'api_errors_l30', 'api_timeouts_l30', 'error_rate', 'help_opens_l30',
    # Screen journey (3)
    'onboarding_step_reached', 'kyc_completed', 'onboarding_completed',
    # Timing (4)
    'days_since_first_event', 'days_to_first_order', 'tx_regularity_score',
    'is_one_and_done',
    # Feature interactions (4)
    'kyc_completed_no_order', 'errors_before_first_order',
    'high_intent_no_completion', 'single_session_deep_funnel',
]

LABEL_COL = 'churn_label'

# Risk tier thresholds (DEC-010)
RISK_TIERS = {
    'CRITICAL': 0.80,
    'HIGH':     0.60,
    'MEDIUM':   0.40,
    'LOW':      0.00,
}

# Corridor mapping (currency → route)
CORRIDOR_MAP = {
    'AED': 'UAE → India',
    'GBP': 'UK → India',
    'USD': 'USA → India',
    'EUR': 'Europe → India',
}

# Intervention types with channel/cost/lift
INTERVENTIONS = {
    'support_callback':  {'channel': 'Phone + SMS',      'cost': 3.50, 'lift': '18-22%'},
    'speed_guarantee':   {'channel': 'WhatsApp + Email',  'cost': 1.20, 'lift': '12-16%'},
    'loyalty_discount':  {'channel': 'Email + In-app',    'cost': 2.00, 'lift': '14-18%'},
    'priority_queue':    {'channel': 'SMS + In-app',      'cost': 0.50, 'lift': '10-14%'},
    're_engagement':     {'channel': 'Email + Push',      'cost': 0.15, 'lift': '6-9%'},
}

# Corridor list for synthetic data
CORRIDORS = ['UK → India', 'UAE → India', 'USA → India']

# Onboarding step ordering for ordinal encoding
ONBOARDING_STEPS = {
    'signup_screen':    0,
    'phone_verify':     1,
    'personal_details': 2,
    'kyc_upload':       3,
    'kyc_review':       4,
    'kyc_verified':     5,
}

# Events to export from Mixpanel
EXPORT_EVENTS = [
    'Screen loaded', 'ORDER_CREATED', 'ORDER_COMPLETED', 'send now click',
    'bifrost api failed', 'bifrost api timeout exception',
    'home_screen_loaded', 'transfer_screen_loaded',
    'review_transfer_screen_loaded', 'help_and_support_screen_loaded',
    'chat_with_us_clicked', '$ae_session',
]

# Heuristic risk thresholds used in risk scoring
INACTIVITY_THRESHOLD_DAYS = 14
HIGH_FAIL_RATE_THRESHOLD = 0.3

# Churn labeling window
CHURN_WINDOW_DAYS = 60
