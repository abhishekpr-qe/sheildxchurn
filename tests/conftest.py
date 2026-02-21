"""Shared test fixtures for the sheildxchurn test suite."""
import pytest

from churn.infra.config import ExportSettings, MixpanelSettings, RedshiftSettings


@pytest.fixture
def sample_user_data():
    """Minimal user data dict for testing."""
    return {
        'user_id': 'test_user_001',
        'corridor': 'UK → India',
        'tenure_days': 90,
        'total_txns': 5,
        'completed_txns': 4,
        'failed_txns': 1,
        'total_volume': 2500.0,
        'days_since_last': 15,
        'fail_rate': 0.2,
        'stuck_rate': 0.05,
        'risk_score': 0.65,
        'churn_probability': 0.65,
        'risk_tier': 'HIGH',
        'reasons': [
            {'code': 'inactivity', 'description': 'No activity for 15 days', 'weight': 0.4},
        ],
    }


@pytest.fixture
def redshift_settings():
    """Minimal RedshiftSettings for testing."""
    return RedshiftSettings(
        host='localhost',
        port=5439,
        user='admin',
        password='pw',
        database='dev',
        schema='public',
    )


@pytest.fixture
def mixpanel_settings():
    """Minimal MixpanelSettings for testing."""
    return MixpanelSettings(
        base_url='https://data.mixpanel.com/api/2.0',
        engage_url='https://mixpanel.com/api/2.0',
        timeout_seconds=30,
    )


@pytest.fixture
def export_settings():
    """Minimal ExportSettings for testing."""
    return ExportSettings(
        event_name='Screen loaded',
        from_date='2025-01-01',
        to_date='2025-12-31',
    )
