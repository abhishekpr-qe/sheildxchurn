"""Tests for churn.service.analysis — pure pipeline, mocked I/O."""
from unittest.mock import MagicMock, patch

from churn.domain.models import FunnelConfig, ScreenEvent
from churn.infra.config import AppConfig, ExportSettings, MixpanelSettings, RedshiftSettings
from churn.service.analysis import AnalysisResult, analyze_events, run_analysis


def _make_config(funnels=()):
    return AppConfig(
        redshift=RedshiftSettings('h', 5439, 'u', 'p', 'db', 'public'),
        mixpanel=MixpanelSettings('http://base', 'http://engage', 30),
        export=ExportSettings('Screen loaded', '2025-01-01', '2025-12-31'),
        funnels=funnels,
        api_secret='secret',
    )


class TestAnalyzeEvents:
    def test_empty_events(self):
        result = analyze_events([], _make_config())
        assert isinstance(result, AnalysisResult)
        assert result.total_events == 0
        assert result.total_sessions == 0
        assert result.funnel_results == ()
        assert result.drop_offs == ()

    def test_single_event(self):
        events = [ScreenEvent('u1', 'Home', 1000)]
        result = analyze_events(events, _make_config())
        assert result.total_events == 1
        assert result.total_sessions == 1

    def test_with_funnel(self):
        events = [
            ScreenEvent('u1', 'Home', 1),
            ScreenEvent('u1', 'SignUp', 2),
            ScreenEvent('u1', 'Dashboard', 3),
        ]
        funnel = FunnelConfig(name='onboarding', steps=('Home', 'SignUp', 'Dashboard'))
        result = analyze_events(events, _make_config(funnels=(funnel,)))
        assert len(result.funnel_results) == 1
        assert result.funnel_results[0].name == 'onboarding'
        assert result.funnel_results[0].total_completed == 1


class TestRunAnalysis:
    @patch('churn.service.analysis.MixpanelClient')
    def test_delegates_to_client(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.export_events.return_value = []
        mock_client_cls.return_value = mock_client

        result = run_analysis(_make_config())

        mock_client_cls.assert_called_once()
        mock_client.export_events.assert_called_once()
        assert isinstance(result, AnalysisResult)
