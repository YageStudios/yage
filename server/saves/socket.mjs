const actions = new Set(['createFamily', 'createMember', 'listCareers', 'getCareer', 'putCareer', 'deleteCareer', 'putOfflineCopy', 'listSlots', 'promoteSlot', 'getProfile', 'putProfile', 'ledgerOpen', 'ledgerApply', 'ledgerSince']);

/** Acknowledgements carry error values. Save messages never enter relay/game rooms. */
export function attachSaveApi(io, service) {
    io.on('connection', socket => {
        socket.on('save:request', async (request, acknowledge) => {
            if (typeof acknowledge !== 'function') return;
            if (!request || !actions.has(request.action)) {
                acknowledge({ ok: false, error: { code: 'invalid_request', message: 'Unknown save action.' } });
                return;
            }
            try { acknowledge(await service.request(request.action, request.input)); }
            catch { acknowledge({ ok: false, error: { code: 'server_error', message: 'Save request failed. Retry later.' } }); }
        });
    });
}
