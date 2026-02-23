import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { darkChartDefaults } from '../../config/theme'

interface HeatmapChartProps {
  series: { name: string; data: number[] }[]
  height?: number
}

export function HeatmapChart({ series, height = 300 }: HeatmapChartProps) {
  const options: ApexOptions = {
    ...darkChartDefaults,
    chart: { ...darkChartDefaults.chart, type: 'heatmap' },
    colors: ['#7C57CC'],
    plotOptions: {
      heatmap: {
        radius: 4,
        colorScale: {
          ranges: [
            { from: 0, to: 25, color: '#1A1A1E' },
            { from: 26, to: 50, color: '#3A3A42' },
            { from: 51, to: 75, color: '#6366F1' },
            { from: 76, to: 100, color: '#7C57CC' },
          ],
        },
      },
    },
  }

  return <Chart options={options} series={series} type="heatmap" height={height} />
}
