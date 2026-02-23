import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { darkChartDefaults } from '../../config/theme'

interface DonutChartProps {
  labels: string[]
  series: number[]
  colors?: string[]
  height?: number
}

export function DonutChart({ labels, series, colors, height = 300 }: DonutChartProps) {
  const options: ApexOptions = {
    ...darkChartDefaults,
    chart: { ...darkChartDefaults.chart, type: 'donut' },
    labels,
    colors: colors || ['#7C57CC', '#EF4444', '#F59E0B', '#22C55E', '#6366F1'],
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            total: { show: true, label: 'Total', color: '#A1A1AA', fontSize: '12px' },
            value: { color: '#F5F5F7', fontSize: '20px', fontWeight: '700' },
          },
        },
      },
    },
    stroke: { show: false },
    legend: { ...darkChartDefaults.legend, position: 'bottom' },
  }

  return <Chart options={options} series={series} type="donut" height={height} />
}
