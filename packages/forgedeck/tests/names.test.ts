import { describe, it, expect } from 'vitest'
import { routeToName, fnToName, routePathFromFile } from '../src/ir/names'

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
})
