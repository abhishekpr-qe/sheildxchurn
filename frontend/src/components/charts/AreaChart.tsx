import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { darkChartDefaults } from '../../config/theme'

interface AreaChartProps {
  categories?: string[]
  series: { name: string; data: number[] }[]
  height?: number
  color?: string
  sparkline?: boolean
}

export function AreaChart({ categories, series, height = 200, color = '#7C57CC', sparkline }: AreaChartProps) {
  const options: ApexOptions = {
    ...darkChartDefaults,
    chart: {
      ...darkChartDefaults.chart,
      type: 'area',
      sparkline: sparkline ? { enabled: true } : undefined,
    },
    xaxis: {
      ...darkChartDefaults.xaxis,
      categories,
    },
    colors: [color],
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] },
    },
    stroke: { curve: 'smooth', width: 2 },
  }

  return <Chart options={options} series={series} type="area" height={height} />
}
