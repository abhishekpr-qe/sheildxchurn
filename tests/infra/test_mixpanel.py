import json
from unittest.mock import patch, MagicMock

from churn.domain.models import ScreenEvent
from churn.infra.config import MixpanelSettings, ExportSettings
from churn.infra.mixpanel import MixpanelClient, _parse_export_stream


SETTINGS = MixpanelSettings(
    base_url='https://data.mixpanel.com/api/2.0',
    engage_url='https://mixpanel.com/api/2.0',
    timeout_seconds=30,
)


class TestMixpanelClient:
    def test_export_events_parses_jsonl(self):
        lines = [
            json.dumps({'event': 'Screen loaded', 'properties': {
                'distinct_id': 'u1', 'screen_name': 'Home', 'time': 1000,
            }}),
            json.dumps({'event': 'Screen loaded', 'properties': {
                'distinct_id': 'u2', 'screen_name': 'Dashboard', 'time': 2000,
            }}),
        ]
        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = lines
        mock_resp.raise_for_status = MagicMock()

        with patch('churn.infra.mixpanel.requests.get', return_value=mock_resp):
            client = MixpanelClient(SETTINGS, api_secret='test')
            export = ExportSettings(event_name='Screen loaded', from_date='2025-01-01', to_date='2025-12-31')
            events = client.export_events(export)

        assert len(events) == 2
        assert all(isinstance(e, ScreenEvent) for e in events)
        assert events[0].distinct_id == 'u1'
        assert events[0].screen_name == 'Home'
        assert events[1].timestamp == 2000

    def test_get_user_profiles_paginates(self):
        page1 = {'results': [{'$distinct_id': 'u1'}], 'total': 2, 'session_id': 'abc'}
        page2 = {'results': [{'$distinct_id': 'u2'}], 'total': 2, 'session_id': 'abc'}

        call_count = 0
        def mock_get(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            resp = MagicMock()
            resp.json.return_value = page1 if call_count == 1 else page2
            resp.raise_for_status = MagicMock()
            return resp

        with patch('churn.infra.mixpanel.requests.get', side_effect=mock_get):
            client = MixpanelClient(SETTINGS, api_secret='test')
            profiles = client.get_user_profiles()

        assert len(profiles) == 2
        assert call_count == 2

    def test_get_user_profiles_single_page(self):
        page1 = {'results': [{'$distinct_id': 'u1'}], 'total': 1}

        mock_resp = MagicMock()
        mock_resp.json.return_value = page1
        mock_resp.raise_for_status = MagicMock()

        with patch('churn.infra.mixpanel.requests.get', return_value=mock_resp):
            client = MixpanelClient(SETTINGS, api_secret='test')
            profiles = client.get_user_profiles()

        assert len(profiles) == 1

    def test_empty_profiles(self):
        page1 = {'results': [], 'total': 0}

        mock_resp = MagicMock()
        mock_resp.json.return_value = page1
        mock_resp.raise_for_status = MagicMock()

        with patch('churn.infra.mixpanel.requests.get', return_value=mock_resp):
            client = MixpanelClient(SETTINGS, api_secret='test')
            profiles = client.get_user_profiles()

        assert len(profiles) == 0


class TestParseExportStream:
    def test_parses_screen_events(self):
        lines = [
            json.dumps({'event': 'Screen loaded', 'properties': {
                'distinct_id': 'u1', 'screen_name': 'Home', 'time': 1000,
            }}),
        ]
        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = lines

        events = list(_parse_export_stream(mock_resp))
        assert len(events) == 1
        assert events[0] == ScreenEvent(distinct_id='u1', screen_name='Home', timestamp=1000)

    def test_skips_empty_lines(self):
        lines = ['', json.dumps({'event': 'X', 'properties': {'distinct_id': 'u1', 'screen_name': 'A', 'time': 1}}), '']
        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = lines

        events = list(_parse_export_stream(mock_resp))
        assert len(events) == 1

    def test_fallback_screen_name(self):
        lines = [json.dumps({'event': 'X', 'properties': {'distinct_id': 'u1', 'time': 1}})]
        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = lines

        events = list(_parse_export_stream(mock_resp))
        assert events[0].screen_name == 'unknown'
