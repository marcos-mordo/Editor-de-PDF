interface Props {
  size?: number;
  withText?: boolean;
  className?: string;
}

/**
 * Intuitive PDF editor logo:
 *  - Orange rounded square (warm, recognizable)
 *  - White document with folded corner (universal "file" symbol)
 *  - Bold "PDF" letters on the page (immediately readable)
 *  - Pencil tip at the corner (clear "editable" affordance)
 */
export function Logo({ size = 40, withText = false, className }: Props) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Editor de PDF"
      >
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF9900" />
            <stop offset="100%" stopColor="#E47911" />
          </linearGradient>
          <linearGradient id="pencil" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD814" />
            <stop offset="100%" stopColor="#F7CA00" />
          </linearGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Orange rounded background */}
        <rect x="2" y="2" width="60" height="60" rx="12" fill="url(#bg)" />

        {/* Document body with folded top-right corner */}
        <g filter="url(#shadow)">
          <path
            d="M 14 14 L 40 14 L 50 24 L 50 52 Q 50 54 48 54 L 16 54 Q 14 54 14 52 Z"
            fill="#FFFFFF"
          />
          {/* The fold */}
          <path d="M 40 14 L 50 24 L 40 24 Z" fill="#EAEDED" />
          <path
            d="M 40 14 L 50 24 L 40 24 Z"
            fill="none"
            stroke="#D5D9D9"
            strokeWidth="0.5"
          />
        </g>

        {/* PDF text on the page */}
        <text
          x="32"
          y="42"
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="11"
          fontWeight="800"
          fill="#131A22"
          letterSpacing="0.5"
        >
          PDF
        </text>

        {/* Pencil tip overlapping bottom-right */}
        <g transform="translate(38, 38) rotate(-45)">
          <rect
            x="0"
            y="0"
            width="22"
            height="6"
            rx="1"
            fill="url(#pencil)"
            stroke="#A88734"
            strokeWidth="0.5"
          />
          <rect x="0" y="0" width="3" height="6" fill="#E47911" />
          <polygon points="22,0 26,3 22,6" fill="#0F1111" />
        </g>
      </svg>
      {withText && (
        <span className="font-bold text-ink-on-dark text-base tracking-tight">
          Editor de PDF
        </span>
      )}
    </div>
  );
}
