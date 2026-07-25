import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'arrow-up'
  | 'book'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'download'
  | 'file'
  | 'folder'
  | 'menu'
  | 'mic'
  | 'more'
  | 'pause'
  | 'play'
  | 'plus'
  | 'redo'
  | 'search'
  | 'settings'
  | 'sparkles'
  | 'stop'
  | 'trash'
  | 'undo'
  | 'waveform'
  | 'volume'
  | 'x';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const paths: Record<IconName, ReactNode> = {
    'arrow-up': (
      <>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h5" />
      </>
    ),
    folder: (
      <path d="M3 6.5h6l2 2h10v9.75A1.75 1.75 0 0 1 19.25 20H4.75A1.75 1.75 0 0 1 3 18.25z" />
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    pause: (
      <>
        <path d="M9 7v10M15 7v10" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    redo: (
      <>
        <path d="m18 8 3 3-3 3" />
        <path d="M3 17v-1a5 5 0 0 1 5-5h13" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.55 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.55a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.45 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.43.7.78.93.3.2.67.32 1.05.33H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25z" />
        <path d="m18.5 14 .75 2.25L21.5 17l-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75z" />
        <path d="m5 13 .6 1.9 1.9.6-1.9.6L5 18l-.6-1.9-1.9-.6 1.9-.6z" />
      </>
    ),
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
      </>
    ),
    undo: (
      <>
        <path d="m6 8-3 3 3 3" />
        <path d="M21 17v-1a5 5 0 0 0-5-5H3" />
      </>
    ),
    waveform: (
      <>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" />
      </>
    ),
    volume: (
      <>
        <path d="M11 5 6.5 9H3v6h3.5l4.5 4z" />
        <path d="M15 9.25a4 4 0 0 1 0 5.5M17.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    ),
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.65}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
