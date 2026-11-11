import { Text } from '@lobehub/ui'

export function RingProgress({
  percent,
  size = 72,
  stroke = 6,
  label,
}: {
  percent?: number | null
  size?: number
  stroke?: number
  label?: string
}) {
  const value = Math.max(0, Math.min(100, Number(percent ?? 0)))
  const known = typeof percent === 'number' && Number.isFinite(percent)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - (known ? value : 22) / 100)
  const center = size / 2

  return (
    <div className="ring-progress" style={{ width: size, height: size }}>
      <div
        className={
          known ? 'ring-progress__spin' : 'ring-progress__spin is-indeterminate'
        }
      >
        <svg
          className="ring-progress__svg"
          height={size}
          viewBox={`0 0 ${String(size)} ${String(size)}`}
          width={size}
        >
          <g transform={`rotate(-90 ${String(center)} ${String(center)})`}>
            <circle
              className="ring-progress__track"
              cx={center}
              cy={center}
              fill="none"
              r={radius}
              strokeWidth={stroke}
            />
            <circle
              className="ring-progress__bar"
              cx={center}
              cy={center}
              fill="none"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              strokeWidth={stroke}
            />
          </g>
        </svg>
      </div>
      {(known || label) && (
        <div className="ring-progress__label">
          {known ? (
            <span className="ring-progress__value">{`${String(Math.round(value))}%`}</span>
          ) : null}
          {label ? (
            <Text as="span" className="ring-progress__caption" type="secondary">
              {label}
            </Text>
          ) : null}
        </div>
      )}
    </div>
  )
}
