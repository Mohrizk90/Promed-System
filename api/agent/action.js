// POST /api/agent/action — the owner presses Confirm / Cancel / Undo on an agent card.
import { authenticateRequest } from '../_lib/auth.js'
import { readJsonBody, requireMember, sendError } from '../_lib/agent/http.js'
import { checkGemini } from '../_lib/agent/health.js'

export const config = { maxDuration: 30 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userClient } = await authenticateRequest(req)
    await requireMember(userClient)
    const { op, actionId, force } = readJsonBody(req)
    if (op === 'health') return res.status(200).json(await checkGemini())
    if (!UUID.test(actionId || '')) return res.status(400).json({ error: 'Invalid action id' })

    const call = async (fn, args) => {
      const { data, error } = await userClient.rpc(fn, args)
      if (error) {
        const e = new Error(error.message)
        e.status = 409
        throw e
      }
      return data
    }

    let result
    if (op === 'confirm') {
      try {
        result = await call('agent_commit', { p_action: actionId })
      } catch (e) {
        await userClient.rpc('agent_mark_failed', { p_action: actionId, p_error: e.message })
        throw e
      }
    } else if (op === 'cancel') {
      result = await call('agent_cancel', { p_action: actionId })
    } else if (op === 'undo') {
      result = await call('agent_undo', { p_action: actionId, p_force: force === true })
    } else {
      return res.status(400).json({ error: 'op must be confirm, cancel or undo' })
    }

    const { data: action } = await userClient.from('agent_actions')
      .select('id, kind, summary, status, error, result, applied_at, undone_at').eq('id', actionId).maybeSingle()
    return res.status(200).json({ ok: true, result, action })
  } catch (err) {
    sendError(res, err, 'agent/action')
  }
}
