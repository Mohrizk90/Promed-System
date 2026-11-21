// The agent talks to the database only through Postgres functions (RPC). Two adapters:
//  - supabaseDb: production, with the signed-in user's token (row rules apply)
//  - pgDb: tests / a future VPS, a plain `pg` client already switched to the user's role

// Functions that return a set of rows (PostgREST returns an array for these).
const SET_RETURNING = new Set(['agent_search', 'client_balances', 'supplier_balances', 'client_invoice_status'])
const RETURNS_VOID = new Set(['agent_cancel', 'agent_mark_failed', 'agent_forget'])

export function supabaseDb(userClient) {
  return {
    async rpc(fn, args = {}) {
      const { data, error } = await userClient.rpc(fn, args)
      if (error) throw new Error(error.message || String(error))
      return data
    },
  }
}

export function pgDb(client) {
  return {
    async rpc(fn, args = {}) {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`Bad function name ${fn}`)
      const keys = Object.keys(args).filter((k) => args[k] !== undefined)
      for (const k of keys) if (!/^p_[a-z0-9_]+$/.test(k)) throw new Error(`Bad argument name ${k}`)
      const params = keys.map((k) => {
        const v = args[k]
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
      })
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
      if (SET_RETURNING.has(fn)) {
        const { rows } = await client.query(`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from ${call} r`, params)
        return rows[0].v
      }
      if (RETURNS_VOID.has(fn)) {
        await client.query(`select ${call}`, params)
        return null
      }
      const { rows } = await client.query(`select to_jsonb(${call}) as v`, params)
      return rows[0].v
    },
  }
}
