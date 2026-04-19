import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SettingsPanel } from '../../src/components/SettingsPanel';
import { Screen, space } from '../../src/components/ui';

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.pad}>
        <SettingsPanel onClose={() => router.back()} closeLabel="Back" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { flex: 1, paddingTop: space.sm },
});
