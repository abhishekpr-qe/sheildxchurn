import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

interface SparkLineProps {
  data: number[]
  color?: string
  height?: number
  width?: number
}

export function SparkLine({ data, color = '#7C57CC', height = 30, width = 80 }: SparkLineProps) {
  const options: ApexOptions = {
    chart: {
      type: 'line',
      sparkline: { enabled: true },
      animations: { enabled: false },
    },
    stroke: { curve: 'smooth', width: 1.5 },
    colors: [color],
    tooltip: { enabled: false },
  }

  return <Chart options={options} series={[{ data }]} type="line" height={height} width={width} />
}
