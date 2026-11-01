import { z } from 'zod'

const name = z.string().trim().min(1).max(30)
const description = z.string().trim().max(200).nullable()

/** Query string of the account title tree. */
export const treeQuery = z.object({
  applies_to: z.enum(['sales', 'purchase', 'deposit', 'withdrawal']).optional(),
  search: z.string().max(50).optional(),
})

/** Body that adds a company account title. */
export const createBody = z.object({ parent_id: z.string().min(1), name, description: description.optional() })

/** Body that renames a company account title. */
export const updateBody = z.object({ name: name.optional(), description: description.optional() })

/** Body or query of an account title deletion. */
export const deleteBody = z.object({ move_to_id: z.string().min(1).optional() })
