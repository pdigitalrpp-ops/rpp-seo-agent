/**
 * Esqueleto que se ve al cambiar de pestaña mientras el servidor arma la
 * página. Las páginas se renderizan en cada visita (datos siempre al día), así
 * que sin esto el clic en el menú parecería no responder durante ese instante.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Cargando">
      <div className="h-7 w-56 rounded-lg bg-gray-200" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-gray-200 bg-white" />
        ))}
      </div>
      <div className="h-96 rounded-2xl border border-gray-200 bg-white" />
    </div>
  )
}
