import { Stack } from 'expo-router';

export default function BattleLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="[battlePda]"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
