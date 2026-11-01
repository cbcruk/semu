import { z } from 'zod'

/** Query string of the upload URL request. */
export const uploadUrlQuery = z.object({ file_name: z.string().trim().min(1).max(200) })

/** Body of the company information share. */
export const shareCompanyBody = z.object({
  receivers: z.array(z.email()).min(1).max(10),
  detail: z
    .object({
      address: z.string().max(200).nullable().optional(),
      email: z.email().nullable().optional(),
      phone_number: z.string().max(20).nullable().optional(),
    })
    .default({}),
  representative_image_id: z.string().nullable().optional(),
  bankbook_image_id: z.string().nullable().optional(),
})
