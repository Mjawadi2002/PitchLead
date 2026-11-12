import { PROJECT_COLORS, type Project } from '@shared/types'

/** A project's logo, or its colored initial when it has none. */
export function ProjectMark({ project, size = 28, className = '' }: { project: Pick<Project, 'name' | 'color' | 'icon'>; size?: number; className?: string }) {
  const radius = Math.round(size * 0.28)
  if (project.icon) {
    return <img className={`proj-img ${className}`} src={project.icon} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: radius }} />
  }
  return (
    <span
      className={`proj-sq ${className}`}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.46), background: PROJECT_COLORS[project.color % PROJECT_COLORS.length] }}
    >
      {(project.name.trim()[0] ?? 'P').toUpperCase()}
    </span>
  )
}

/** Reads an image file, crops it to a centered square and returns a 128 px PNG data URL. */
export function imageToIcon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file (PNG, JPG, SVG or WebP).'))
    if (file.size > 8 * 1024 * 1024) return reject(new Error('That image is larger than 8 MB.'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not open that image.'))
      img.onload = () => {
        const side = Math.min(img.naturalWidth || 128, img.naturalHeight || 128)
        const sx = ((img.naturalWidth || side) - side) / 2
        const sy = ((img.naturalHeight || side) - side) / 2
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 128, 128)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
