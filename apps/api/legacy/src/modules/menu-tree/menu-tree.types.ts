import type { MenuCode } from '../access/access.types'

/** A menu node as stored in `menu_tree_versions.tree`. */
export interface MenuNodeSource {
  id: number
  name: string
  code: MenuCode | null
  icon: string
  to: string | null
  children: MenuNodeSource[]
}

/** A menu node as returned to the client, matching the legacy node shape in snake_case. */
export interface MenuNode {
  id: number
  name: string
  code: MenuCode | null
  category: string | null
  accessible_permissions: null
  is_favoritable: boolean
  is_favorite: boolean
  favorited_at: string | null
  is_promotion: boolean
  promotion_url: string | null
  icon: string
  to: string | null
  children: MenuNode[]
}
