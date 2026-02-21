import os
import tempfile
from unittest.mock import patch

import yaml

from churn.infra.config import (
    AppConfig, RedshiftSettings, MixpanelSettings, ExportSettings,
    load_config,
)


def _write_config(tmpdir, config_dict, secret='test_secret'):
    config_path = os.path.join(tmpdir, 'config.yaml')
    secret_path = os.path.join(tmpdir, 'secret.txt')
    with open(config_path, 'w') as f:
        yaml.dump(config_dict, f)
    with open(secret_path, 'w') as f:
        f.write(secret)
    return config_path, secret_path


MINIMAL_CONFIG = {
    'redshift': {
        'host': 'localhost',
        'port': 5439,
        'user': 'admin',
        'password': 'pw',
        'database': 'dev',
        'schema': 'public',
    },
    'mixpanel': {
        'base_url': 'https://data.mixpanel.com/api/2.0',
        'engage_url': 'https://mixpanel.com/api/2.0',
        'timeout_seconds': 30,
    },
    'export': {
        'event_name': 'Screen loaded',
        'from_date': '2025-01-01',
        'to_date': '2025-12-31',
    },
}


class TestLoadConfig:
    @patch('dotenv.load_dotenv', return_value=None)
    def test_returns_app_config(self, _mock_dotenv):
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, MINIMAL_CONFIG)
            cfg = load_config(cp, sp)
            assert isinstance(cfg, AppConfig)

    @patch('dotenv.load_dotenv', return_value=None)
    def test_redshift_settings(self, _mock_dotenv):
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, MINIMAL_CONFIG)
            cfg = load_config(cp, sp)
            assert cfg.redshift.host == 'localhost'
            assert cfg.redshift.port == 5439

    @patch('dotenv.load_dotenv', return_value=None)
    def test_mixpanel_settings(self, _mock_dotenv):
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, MINIMAL_CONFIG)
            cfg = load_config(cp, sp)
            assert cfg.mixpanel.timeout_seconds == 30

    @patch('dotenv.load_dotenv', return_value=None)
    def test_api_secret(self, _mock_dotenv):
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, MINIMAL_CONFIG, secret='my_secret')
            cfg = load_config(cp, sp)
            assert cfg.api_secret == 'my_secret'

    @patch('dotenv.load_dotenv', return_value=None)
    def test_funnels_parsed(self, _mock_dotenv):
        config = {**MINIMAL_CONFIG, 'funnels': {
            'onboarding': {'steps': ['Home', 'SignUp', 'Dashboard']},
        }}
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, config)
            cfg = load_config(cp, sp)
            assert len(cfg.funnels) == 1
            assert cfg.funnels[0].name == 'onboarding'
            assert cfg.funnels[0].steps == ('Home', 'SignUp', 'Dashboard')

    @patch('dotenv.load_dotenv', return_value=None)
    def test_env_vars_override_redshift(self, _mock_dotenv):
        with tempfile.TemporaryDirectory() as tmpdir:
            cp, sp = _write_config(tmpdir, MINIMAL_CONFIG)
            with patch.dict(os.environ, {'REDSHIFT_HOST': 'prod.example.com'}):
                cfg = load_config(cp, sp)
                assert cfg.redshift.host == 'prod.example.com'
