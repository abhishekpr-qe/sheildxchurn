import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { darkChartDefaults } from '../../config/theme'

interface BarChartProps {
  categories: string[]
  series: { name: string; data: number[] }[]
  horizontal?: boolean
  stacked?: boolean
  height?: number
  colors?: string[]
  gradient?: boolean
}

export function BarChart({ categories, series, horizontal = false, stacked = false, height = 300, colors, gradient }: BarChartProps) {
  const options: ApexOptions = {
    ...darkChartDefaults,
    chart: {
      ...darkChartDefaults.chart,
      type: 'bar',
      stacked,
    },
    plotOptions: {
      bar: {
        horizontal,
        borderRadius: 4,
        columnWidth: '60%',
        barHeight: '70%',
        ...(gradient ? {
          colors: {
            backgroundBarColors: ['#1A1A1E'],
            backgroundBarOpacity: 0.3,
          },
        } : {}),
      },
    },
    xaxis: {
      ...darkChartDefaults.xaxis,
      categories,
    },
    colors: colors || ['#7C57CC', '#A78BFA', '#6366F1', '#22C55E'],
    fill: gradient ? {
      type: 'gradient',
      gradient: { shade: 'dark', type: 'horizontal', shadeIntensity: 0.3, opacityFrom: 1, opacityTo: 0.8 },
    } : { opacity: 1 },
  }

  return <Chart options={options} series={series} type="bar" height={height} />
}
