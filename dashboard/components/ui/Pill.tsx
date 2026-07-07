import type { ButtonHTMLAttributes, ReactNode } from "react"

type PillVariant = "nav" | "solid" | "accent" | "tag"

/** Clases del pill según variante/estado — reutilizable en <button> o <a> (Link). */
export function pillClasses(variant: PillVariant, active = false, className = ""): string {
  if (variant === "nav") {
    return `rounded-full px-4 py-1.5 text-sm font-semibold transition ${
      active
        ? "bg-white text-rpp-ink border border-rpp-ink/80"
        : "text-rpp-ink/70 hover:text-rpp-ink border border-transparent"
    } ${className}`
  }
  if (variant === "solid") {
    return `rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
      active
        ? "bg-rpp-ink text-white border border-rpp-ink"
        : "bg-white text-gray-600 border border-gray-300 hover:border-gray-400"
    } ${className}`
  }
  if (variant === "accent") {
    return `rounded-full px-3 py-1 text-xs font-bold transition border-2 ${
      active
        ? "bg-white text-rpp-teal border-rpp-teal"
        : "bg-transparent text-gray-500 border-transparent hover:text-gray-800"
    } ${className}`
  }
  // tag (color se aplica vía style, no clase)
  return `rounded-full px-2.5 py-1 text-xs font-semibold border transition ${className}`
}

type PillProps = {
  variant: PillVariant
  active?: boolean
  children: ReactNode
  /** Solo para variant="tag": color base del chip (hex o clase de color). */
  color?: string
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "color">

/**
 * Botón pill compartido (para acciones/filtros, NO para navegación — un
 * <Link> ya renderiza <a>, y anidar un <button> dentro sería HTML inválido;
 * para eso usar `pillClasses("nav", ...)` directo sobre el <Link>).
 * Variantes:
 * - solid: filtro primario (activo = pill negra sólida; inactivo = outline gris)
 * - accent: selección tipo item de lista (activo = borde teal)
 * - tag: chip de categoría/severidad, coloreado por `color`
 */
export function Pill({ variant, active = false, children, color, className = "", ...rest }: PillProps) {
  const tagStyle =
    variant === "tag"
      ? { color: color ?? "#6b7280", borderColor: `${color ?? "#6b7280"}55`, backgroundColor: `${color ?? "#6b7280"}14` }
      : undefined

  return (
    <button {...rest} className={pillClasses(variant, active, className)} style={tagStyle}>
      {children}
    </button>
  )
}

/** Variante no-interactiva de "tag" (span en vez de button) para badges de solo lectura. */
export function TagBadge({ color, children, className = "" }: { color?: string; children: ReactNode; className?: string }) {
  const tagColor = color ?? "#6b7280"
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border ${className}`}
      style={{
        color: tagColor,
        borderColor: `${tagColor}55`,
        backgroundColor: `${tagColor}14`,
      }}
    >
      {children}
    </span>
  )
}
