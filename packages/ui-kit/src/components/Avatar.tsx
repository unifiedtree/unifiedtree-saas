import React from 'react'
import { cn } from '../lib/cn'

const avatarSizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
} as const

const statusColors = {
  online: 'bg-emerald-400',
  away: 'bg-amber-400',
  busy: 'bg-red-400',
  offline: 'bg-slate-500',
} as const

const statusSizes = {
  xs: 'w-1.5 h-1.5 border',
  sm: 'w-2 h-2 border',
  md: 'w-2.5 h-2.5 border',
  lg: 'w-3 h-3 border-2',
  xl: 'w-4 h-4 border-2',
} as const

// Consistent color palette derived from name hash
const AVATAR_COLORS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-red-600',
]

function getColorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string
  name?: string
  size?: keyof typeof avatarSizes
  status?: keyof typeof statusColors
  alt?: string
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, name = '', size = 'md', status, alt, className, ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false)
    const showImage = src && !imgError
    const initials = getInitials(name)
    const gradientColor = getColorFromName(name)

    return (
      <div
        ref={ref}
        className={cn('relative inline-flex items-center justify-center shrink-0', className)}
        {...props}
      >
        <div
          className={cn(
            'rounded-full overflow-hidden flex items-center justify-center font-semibold text-white',
            !showImage && `bg-gradient-to-br ${gradientColor}`,
            avatarSizes[size]
          )}
        >
          {showImage ? (
            <img
              src={src}
              alt={alt ?? name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        {status && (
          <span
            className={cn(
              'absolute bottom-0 right-0 rounded-full border-slate-900',
              statusColors[status],
              statusSizes[size]
            )}
          />
        )}
      </div>
    )
  }
)
Avatar.displayName = 'Avatar'

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  avatars: Pick<AvatarProps, 'src' | 'name' | 'alt'>[]
  max?: number
  size?: keyof typeof avatarSizes
}

export const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ avatars, max = 4, size = 'md', className, ...props }, ref) => {
    const visible = avatars.slice(0, max)
    const overflow = avatars.length - max

    return (
      <div ref={ref} className={cn('flex items-center', className)} {...props}>
        {visible.map((avatar, i) => (
          <div key={i} className={i > 0 ? '-ml-2' : ''} style={{ zIndex: visible.length - i }}>
            <Avatar
              {...avatar}
              size={size}
              className="ring-2 ring-slate-900"
            />
          </div>
        ))}
        {overflow > 0 && (
          <div
            className={cn(
              '-ml-2 rounded-full bg-slate-700 ring-2 ring-slate-900 flex items-center justify-center text-xs font-semibold text-slate-300',
              avatarSizes[size]
            )}
          >
            +{overflow}
          </div>
        )}
      </div>
    )
  }
)
AvatarGroup.displayName = 'AvatarGroup'
