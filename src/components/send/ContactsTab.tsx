import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ContactsTabProps {
  contacts: any[];
  selectedItems: any[];
  toggleSelection: (item: any) => void;
  toggleAllSelection: (items: any[]) => void;
  colors: any;
  typography: any;
  styles: any;
}

export const ContactsTab: React.FC<ContactsTabProps> = ({
  contacts,
  selectedItems,
  toggleSelection,
  toggleAllSelection,
  colors,
  typography,
  styles,
}) => {
  const isAllSelected = contacts.length > 0 && contacts.every(c => selectedItems.find(i => i.id === c.id));

  const renderContactItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    const initial = item.name.charAt(0).toUpperCase();

    return (
      <TouchableOpacity 
        onPress={() => toggleSelection(item)} 
        style={[
          styles.listItem,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border
          }
        ]}
      >
        <View style={[styles.listIconBox, { backgroundColor: '#F3E5F5' }]}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#9C27B0' }}>{initial}</Text>
        </View>
        <View style={styles.listDetails}>
          <Text style={[styles.listName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.listSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
            {item.phoneNumbers[0]?.number || 'No number'}
          </Text>
        </View>
        <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {isSelected && <Icon name="check" size={14} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {contacts.length > 0 && (
        <TouchableOpacity
          onPress={() => toggleAllSelection(contacts)}
          style={[styles.dateHeader, { borderBottomColor: colors.border, paddingHorizontal: 20 }]}
        >
          <Text style={[styles.dateTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>
            Select All Contacts ({contacts.length})
          </Text>
          <View style={[styles.checkbox, isAllSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isAllSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        </TouchableOpacity>
      )}
      <FlatList
        key="contacts"
        data={contacts}
        renderItem={renderContactItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};
