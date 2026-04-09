interface LogoProps {
  size?: number
  className?: string
}

export function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="linearr-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#linearr-g)" />
      {/* L vertical bar */}
      <rect x="20" y="20" width="13" height="56" rx="5" fill="white" />
      {/* L horizontal bar */}
      <rect x="20" y="63" width="56" height="13" rx="5" fill="white" />
      {/* EPG schedule bars */}
      <rect x="40" y="20" width="36" height="7" rx="3" fill="white" fillOpacity="0.55" />
      <rect x="40" y="33" width="25" height="7" rx="3" fill="white" fillOpacity="0.38" />
      <rect x="40" y="46" width="31" height="7" rx="3" fill="white" fillOpacity="0.38" />
    </svg>
  )
}
