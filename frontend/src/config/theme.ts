import type { ApexOptions } from 'apexcharts'

export const TIER_COLORS = {
  CRITICAL: '#DC2626',
  HIGH: '#D97706',
  MEDIUM: '#4F46E5',
  LOW: '#16A34A',
} as const

export const CHART_COLORS = {
  primary: '#5523B2',
  secondary: '#7C57CC',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#D97706',
  info: '#4F46E5',
  muted: '#9B8EC4',
} as const

export const darkChartDefaults: ApexOptions = {
  chart: {
    background: 'transparent',
    foreColor: '#6B5B95',
    toolbar: { show: false },
    animations: { enabled: true, speed: 600 },
  },
  grid: {
    borderColor: '#E2DCF0',
    strokeDashArray: 3,
  },
  tooltip: {
    theme: 'light',
    style: { fontSize: '12px' },
  },
  xaxis: {
    axisBorder: { color: '#E2DCF0' },
    axisTicks: { color: '#E2DCF0' },
    labels: { style: { colors: '#6B5B95', fontSize: '11px' } },
  },
  yaxis: {
    labels: { style: { colors: '#6B5B95', fontSize: '11px' } },
  },
  legend: {
    labels: { colors: '#6B5B95' },
    fontSize: '12px',
  },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth' },
}
