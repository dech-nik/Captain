import React from 'react'

interface CaptainIconProps {
  size?: number
  className?: string
  animated?: boolean
}

const PirateTricornPaths: React.FC = () => (
  <>
    {/* Cobalt Captain's Plume */}
    <path
      d="M 558 318 C 626 226 742 198 852 238 C 800 268 770 306 758 348 C 804 336 844 344 876 370 C 806 426 714 446 618 426 Z"
      fill="#10B981"
    />
    {/* Crown dome */}
    <path
      d="M 332 456 C 344 348 416 286 512 286 C 608 286 680 348 692 456 Z"
      fill="#334155"
    />
    {/* Midnight-slate Pirate Tricorn Wings */}
    <path
      d="M 512 272 C 432 272 384 446 276 462 C 214 472 168 442 136 398 C 124 382 106 396 114 418 C 148 524 218 624 294 668 Q 403 636 512 636 Z"
      fill="#1E293B"
    />
    <path
      d="M 512 272 C 592 272 640 446 748 462 C 810 472 856 442 888 398 C 900 382 918 396 910 418 C 876 524 806 624 730 668 Q 621 636 512 636 Z"
      fill="#0F172A"
    />
    {/* Cobalt Brim Braid */}
    <path
      d="M 132 414 C 172 458 222 484 282 474 C 392 456 438 288 512 288 C 586 288 632 456 742 474 C 802 484 852 458 892 414"
      stroke="#10B981"
      strokeWidth="20"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Pirate Bandana Sash + Fluttering Knot Tails */}
    <path
      d="M 284 662 Q 512 606 740 662 C 732 692 714 706 688 699 Q 512 654 336 699 C 310 706 292 692 284 662 Z"
      fill="#059669"
    />
    <path d="M 314 686 L 252 738 L 288 746 L 336 696 Z" fill="#059669" />
    <path d="M 334 692 L 298 758 L 332 754 L 356 698 Z" fill="#047857" />
    {/* White Ship's Wheel Emblem */}
    <circle cx="512" cy="492" r="52" stroke="#FFFFFF" strokeWidth="16" />
    <circle cx="512" cy="492" r="17" fill="#FFFFFF" />
    <path
      d="M 512 412 V 440 M 512 544 V 572 M 432 492 H 460 M 564 492 H 592 M 455 435 L 475 455 M 549 529 L 569 549 M 569 435 L 549 455 M 475 529 L 455 549"
      stroke="#FFFFFF"
      strokeWidth="15"
      strokeLinecap="round"
    />
  </>
)

/**
 * Standalone Captain Pirate Tricorn + Ship's Helm emblem (matches `build/icon.svg` 1:1).
 */
export const CaptainIcon: React.FC<CaptainIconProps> = ({
  size = 32,
  className,
  animated = false
}) => {
  return (
    <svg
      viewBox="0 0 168 128"
      width={Math.round((size * 168) / 128)}
      height={size}
      fill="none"
      className={`${animated ? 'captain-icon-animated ' : ''}${className || ''}`.trim()}
      aria-hidden="true"
    >
      <g transform="translate(8, 4) scale(0.185)">
        <g transform="translate(-96, -184)">
          <PirateTricornPaths />
        </g>
      </g>
    </svg>
  )
}

interface CaptainWordmarkProps {
  height?: number
  className?: string
}

/**
 * Horizontal Captain lockup (Pirate Tricorn emblem + custom geometric vector wordmark `CAPTAIN`),
 * matching `build/logo-horizontal.svg` 1:1.
 */
export const CaptainWordmark: React.FC<CaptainWordmarkProps> = ({ height = 28, className }) => {
  const width = Math.round((height * 660) / 144)
  return (
    <svg
      viewBox="0 0 660 144"
      width={width}
      height={height}
      fill="none"
      className={className}
      role="img"
      aria-label="Captain"
    >
      <g transform="translate(8, 10) scale(0.165)">
        <g transform="translate(-96, -152)">
          <PirateTricornPaths />
        </g>
      </g>

      <g transform="translate(186, 36)">
        <path
          d="M 48 16.5 C 43.2 12.2 37.2 10 30 10 C 14.8 10 4 21.2 4 36 C 4 50.8 14.8 62 30 62 C 37.2 62 43.2 59.8 48 55.5 L 55.2 63.6 C 48.6 69.4 40 72.6 29.6 72.6 C 8.4 72.6 -7.6 57.2 -7.6 36 C -7.6 14.8 8.4 -0.6 29.6 -0.6 C 40 -0.6 48.6 2.6 55.2 8.4 L 48 16.5 Z"
          transform="translate(8, 0)"
          fill="#0F172A"
        />
        <g transform="translate(76, 0)">
          <path d="M 25.5 0 L 36.5 0 L 62 72 L 50 72 L 31 14.5 L 12 72 L 0 72 L 25.5 0 Z" fill="#0F172A" />
          <polygon points="22.8,39 39.2,39 42.4,48.6 19.6,48.6" fill="#059669" />
        </g>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M 0 0 H 27.5 C 43.5 0 53.5 9.2 53.5 23.5 C 53.5 37.8 43.5 47 27.5 47 H 11.5 V 72 H 0 V 0 Z M 11.5 10.2 V 36.8 H 26.8 C 36.4 36.8 41.8 31.8 41.8 23.5 C 41.8 15.2 36.4 10.2 26.8 10.2 H 11.5 Z"
          transform="translate(152, 0)"
          fill="#0F172A"
        />
        <path
          d="M 0 0 H 54 V 10.5 H 32.8 V 72 H 21.2 V 10.5 H 0 V 0 Z"
          transform="translate(216, 0)"
          fill="#0F172A"
        />
        <g transform="translate(278, 0)">
          <path d="M 25.5 0 L 36.5 0 L 62 72 L 50 72 L 31 14.5 L 12 72 L 0 72 L 25.5 0 Z" fill="#0F172A" />
          <polygon points="22.8,39 39.2,39 42.4,48.6 19.6,48.6" fill="#059669" />
        </g>
        <rect x="354" y="0" width="11.6" height="72" fill="#0F172A" />
        <path
          d="M 0 0 H 10.8 L 44.4 51.6 V 0 H 55.8 V 72 H 45 L 11.4 20.4 V 72 H 0 V 0 Z"
          transform="translate(384, 0)"
          fill="#0F172A"
        />
      </g>
    </svg>
  )
}

/**
 * Teleport authentication header lockup styled after Teleport's official web sign-in screen.
 */
export const TeleportBadge: React.FC<{ size?: number }> = ({ size = 32 }) => {
  return (
    <div className="teleport-brand-lockup" aria-label="Teleport">
      <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden="true">
        <rect width="40" height="40" rx="10" fill="#512FC9" />
        <path
          d="M 20 8.5 A 11.5 11.5 0 1 1 9.6 15.1"
          stroke="#FFFFFF"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M 14.2 14.2 A 8.2 8.2 0 1 1 12.4 23.2"
          stroke="#C4B5FD"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="20" cy="20" r="3" fill="#FFFFFF" />
        <circle cx="12.2" cy="11.4" r="2" fill="#DDD6FE" />
      </svg>
      <span className="teleport-brand-word">teleport</span>
    </div>
  )
}

export const BrandMark = CaptainIcon
