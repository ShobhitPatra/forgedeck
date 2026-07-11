import { describe, it, expect } from 'vitest'
import { routeToName, fnToName, routePathFromFile, paramsFromPath } from '../src/ir/names'

describe('names', () => {
  it('derives route path from file path', () => {
    expect(routePathFromFile('app/api/products/route.ts')).toBe('/api/products')
    expect(routePathFromFile('app/api/products/[id]/route.ts')).toBe('/api/products/{id}')
  })
  it('derives tool name from method and path', () => {
    expect(routeToName('GET', '/api/products')).toBe('get_products')
    expect(routeToName('GET', '/api/products/{id}')).toBe('get_products_by_id')
    expect(routeToName('POST', '/api/orders')).toBe('post_orders')
  })
  it('derives tool name from function name', () => {
    expect(fnToName('addToCart')).toBe('add_to_cart')
  })
  it('strips route groups from paths', () => {
    expect(routePathFromFile('app/(internal)/api/admin/route.ts')).toBe('/api/admin')
  })
  it('handles catch all segments', () => {
    expect(routePathFromFile('app/api/files/[...path]/route.ts')).toBe('/api/files/{...path}')
    expect(routeToName('GET', '/api/files/{...path}')).toBe('get_files_by_path')
  })
  it('converts camelCase params to snake case names', () => {
    expect(routePathFromFile('app/api/reports/[reportId]/route.ts')).toBe('/api/reports/{reportId}')
    expect(routeToName('GET', '/api/reports/{reportId}')).toBe('get_reports_by_report_id')
  })
  it('handles paths outside api', () => {
    expect(routeToName('GET', '/dashboard/stats')).toBe('get_dashboard_stats')
  })
  it('extracts param names from a path', () => {
    expect(paramsFromPath('/api/reports/{reportId}/items/{id}')).toEqual(['reportId', 'id'])
    expect(paramsFromPath('/api/files/{...path}')).toEqual(['path'])
  })
})
