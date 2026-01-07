import notifee, { AndroidImportance } from '@notifee/react-native';

class NotificationService {
  async displayTransferNotification(fileName: string, progress: number, isSending: boolean) {
    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
      id: 'transfer',
      name: 'File Transfer',
      importance: AndroidImportance.DEFAULT,
    });

    // Display a notification
    await notifee.displayNotification({
      id: 'transfer_id',
      title: isSending ? `Sending ${fileName}` : `Receiving ${fileName}`,
      body: `${Math.round(progress * 100)}% completed`,
      android: {
        channelId,
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
    const channelId = await notifee.createChannel({
      id: 'transfer_complete',
      name: 'Transfer Complete',
    });

    await notifee.displayNotification({
      title: success ? 'Transfer Completed' : 'Transfer Failed',
      body: success ? `Successfully transferred ${fileName}` : `Failed to transfer ${fileName}`,
      android: {
        channelId,
      },
    });
  }
}

export default new NotificationService();
