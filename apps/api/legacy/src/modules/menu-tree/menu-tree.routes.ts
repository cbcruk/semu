import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../app.types'
import { isFreeCompany } from '../companies/companies.utils'
import { buildMenuTree, loadMenuTree } from './menu-tree.service'

/** Versioned menu tree route; unknown versions return 404 so the client falls back to `latest`. */
export function menuTreeRoutes(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().get('/menu/menu-tree/:version', (c) => {
    const source = loadMenuTree(deps.db, c.req.param('version'))
    return c.json(buildMenuTree(source, c.var.access, isFreeCompany(c.var.company)))
  })
}
