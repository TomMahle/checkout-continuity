import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from "expo-router";

import { useColorScheme } from "@/hooks/use-color-scheme";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Without a title the back button on pushed screens reads "index". */}
        <Stack.Screen name="index" options={{ title: "Home" }} />
      </Stack>
    </ThemeProvider>
  );
}
