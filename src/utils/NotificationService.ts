import notifee, { AndroidImportance } from '@notifee/react-native';

/**
 * NotificationService
 *
 * Channels are created ONCE (idempotent but still async) and cached,
 * so we don't re-create them on every progress update (avoids hundreds
 * of unnecessary async calls during a transfer).
 */
class NotificationService {
  private transferChannelId: string | null = null;
  private completeChannelId: string | null = null;

  // ── Lazy channel initialiser — called once per session ──────────────────
  private async getTransferChannelId(): Promise<string> {
    if (!this.transferChannelId) {
      this.transferChannelId = await notifee.createChannel({
        id: 'transfer',
        name: 'File Transfer',
        importance: AndroidImportance.LOW, // LOW = no sound during progress updates
      });
    }
    return this.transferChannelId;
  }

  private async getCompleteChannelId(): Promise<string> {
    if (!this.completeChannelId) {
      this.completeChannelId = await notifee.createChannel({
        id: 'transfer_complete',
        name: 'Transfer Complete',
        importance: AndroidImportance.DEFAULT, // DEFAULT = sound on completion
      });
    }
    return this.completeChannelId;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async displayTransferNotification(fileName: string, progress: number, isSending: boolean) {
    const channelId = await this.getTransferChannelId();

    await notifee.displayNotification({
      id: 'transfer_id',
      title: isSending ? `Sending ${fileName}` : `Receiving ${fileName}`,
      body: `${Math.round(progress * 100)}% completed`,
      android: {
        channelId,
        smallIcon: 'ic_notification',
        onlyAlertOnce: true,
        progress: {
          max: 100,
          current: Math.round(progress * 100),
        },
      },
    });
  }

  async cancelTransferNotification() {
    await notifee.cancelNotification('transfer_id');
  }

  async displayCompleteNotification(fileName: string, success: boolean) {
    const channelId = await this.getCompleteChannelId();

    await notifee.displayNotification({
      title: success ? '✅ Transfer Completed' : '❌ Transfer Failed',
      body: success
        ? `Successfully transferred ${fileName}`
        : `Failed to transfer ${fileName}`,
      android: {
        channelId,
        smallIcon: 'ic_notification',
      },
    });
  }
}

export default new NotificationService();
