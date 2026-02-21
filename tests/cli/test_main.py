"""Tests for churn.cli.main — CLI argument parsing and dispatch."""
from unittest.mock import MagicMock, patch

from churn.cli.main import _parse_args
from churn.service.analysis import AnalysisResult


class TestParseArgs:
    def test_defaults(self):
        with patch('sys.argv', ['churn']):
            args = _parse_args()
        assert args.config == 'config.yaml'
        assert args.secret == 'key'
        assert args.format == 'table'

    def test_json_format(self):
        with patch('sys.argv', ['churn', '--format', 'json']):
            args = _parse_args()
        assert args.format == 'json'

    def test_custom_config(self):
        with patch('sys.argv', ['churn', '--config', '/tmp/c.yaml', '--secret', '/tmp/s']):
            args = _parse_args()
        assert args.config == '/tmp/c.yaml'
        assert args.secret == '/tmp/s'


class TestMain:
    @patch('churn.cli.main.run_analysis')
    @patch('churn.cli.main.load_config')
    def test_main_calls_pipeline(self, mock_load, mock_run):
        mock_load.return_value = MagicMock()
        mock_run.return_value = AnalysisResult(
            total_events=0, total_sessions=0, funnel_results=(), drop_offs=(),
        )
        with patch('sys.argv', ['churn', '--format', 'json']):
            from churn.cli.main import main
            main()
        mock_load.assert_called_once()
        mock_run.assert_called_once()
