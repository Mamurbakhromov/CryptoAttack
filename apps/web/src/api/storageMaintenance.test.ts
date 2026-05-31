import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearEventData, deleteOldHistory } from './sse';

describe('storage maintenance API client functions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it('sends dashboard and admin tokens separately for destructive maintenance calls', async () => {
    await clearEventData('dashboard-token', 'admin-token');

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/storage/events' }),
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer dashboard-token',
          'x-dashboard-admin-token': 'admin-token'
        }
      })
    );
  });

  it('calls the seven-day history cleanup endpoint with the admin token', async () => {
    await deleteOldHistory('dashboard-token', 'admin-token');

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/storage/history/older-than-7-days' }),
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer dashboard-token',
          'x-dashboard-admin-token': 'admin-token'
        }
      })
    );
  });
});
