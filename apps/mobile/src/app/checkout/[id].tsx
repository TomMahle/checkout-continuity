import {
  PAY_CUTOFF_MS,
  formatCents,
  formatRemaining,
  type SessionSnapshot,
} from "@continuity/checkout";
import { Stack, useLocalSearchParams, useTheme } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCheckoutSession } from "@/hooks/use-checkout-session";

const EXPIRY_TEXT: Record<string, string> = {
  hold_expired: "Your hold ended and the tickets were released.",
  admin_expired: "Your hold was ended early and the tickets were released.",
  too_many_payment_failures:
    "Too many payments were declined, so the tickets were released.",
};

/** Reached by continuity://checkout/<id>. The same session the web shows. */
export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const session = useCheckoutSession(id);
  const { snapshot, remaining, busy } = session;

  // A price increase must be acknowledged: ask natively, once per change.
  const priceKey = snapshot?.priceChanges
    .map((c) => `${c.ticketId}:${c.currentPriceCents}`)
    .join(",");
  const needsAck = snapshot?.status === "price_changed";
  const acceptPrice = session.acceptPrice;
  const changes = snapshot?.priceChanges;
  useEffect(() => {
    if (!needsAck || !changes) return;
    const lines = changes
      .map(
        (c) =>
          `${c.eventName}: ${formatCents(c.quotedPriceCents)} → ${formatCents(c.currentPriceCents)}`,
      )
      .join("\n");
    Alert.alert("A price changed", lines, [
      { text: "Not now", style: "cancel" },
      { text: "Accept new price", onPress: () => void acceptPrice() },
    ]);
    // Re-ask only when the changes themselves differ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAck, priceKey]);

  if (session.loadError && !snapshot) {
    return (
      <Centered>
        <Stack.Screen options={{ title: "Checkout" }} />
        <Text style={{ color: colors.text, textAlign: "center" }}>
          {session.loadError}
        </Text>
        <Button label="Try again" onPress={session.refresh} />
      </Centered>
    );
  }
  if (!snapshot) {
    return (
      <Centered>
        <Stack.Screen options={{ title: "Checkout" }} />
        <ActivityIndicator />
      </Centered>
    );
  }

  const canPay =
    busy === null &&
    (snapshot.status === "active" || snapshot.status === "payment_failed") &&
    remaining !== null &&
    remaining > PAY_CUTOFF_MS;

  const card = {
    backgroundColor: colors.card,
    borderColor: colors.border,
  };

  return (
    // "automatic" insets the content below the translucent iOS header, so the
    // status banner isn't drawn underneath it.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
    >
      <Stack.Screen options={{ title: "Checkout" }} />

      <StatusBanner snapshot={snapshot} />
      {snapshot.priceDrops.length > 0 && session.open && (
        <Banner tone="info" title="Good news: a price dropped">
          {snapshot.priceDrops
            .map(
              (c) =>
                `${c.eventName}: ${formatCents(c.quotedPriceCents)} → ${formatCents(c.currentPriceCents)}`,
            )
            .join("\n")}
        </Banner>
      )}
      {session.problem && (
        <Banner tone="warn" title="Heads up">
          {session.problem}
        </Banner>
      )}

      <View style={[styles.card, card]}>
        {snapshot.items.map((item, index) => {
          const change = snapshot.priceChanges.find(
            (c) => c.ticketId === item.ticketId,
          );
          return (
            <View key={`${item.ticketId}-${index}`} style={styles.row}>
              <Text style={[styles.itemName, { color: colors.text }]}>
                {item.eventName}
              </Text>
              {change ? (
                <Text style={{ color: colors.text }}>
                  <Text style={styles.strike}>
                    {formatCents(change.quotedPriceCents)}
                  </Text>{" "}
                  <Text style={styles.bold}>
                    {formatCents(change.currentPriceCents)}
                  </Text>
                </Text>
              ) : (
                <Text style={{ color: colors.text }}>
                  {formatCents(item.quotedPriceCents)}
                </Text>
              )}
            </View>
          );
        })}
        <View
          style={[styles.row, styles.total, { borderColor: colors.border }]}
        >
          <Text style={[styles.bold, { color: colors.text }]}>Total</Text>
          <Text style={[styles.bold, { color: colors.text }]}>
            {formatCents(snapshot.totalCents)}
          </Text>
        </View>
        <Text style={{ color: colors.text, opacity: 0.7 }}>
          Status: {snapshot.status.replace("_", " ")}
        </Text>
        {session.open && remaining !== null && (
          <Text style={{ color: colors.text, opacity: 0.7 }}>
            {session.timeIsUp
              ? "Time is up. Confirming with the server…"
              : `Your tickets are held for ${formatRemaining(remaining)}`}
          </Text>
        )}
      </View>

      {snapshot.status === "price_changed" && (
        <Button
          label={busy === "accept" ? "Accepting…" : "Accept new price"}
          onPress={() => void session.acceptPrice()}
          disabled={busy !== null}
        />
      )}

      {snapshot.status === "expired" && (
        <Text style={{ color: colors.text, textAlign: "center" }}>
          Start a new checkout from the web page to try again.
        </Text>
      )}

      {(session.open || snapshot.status === "completing") &&
        snapshot.status !== "expired" && (
          <View style={styles.pay}>
            <Text style={[styles.bold, { color: colors.text }]}>Pay</Text>
            <Text style={{ color: colors.text, opacity: 0.7 }}>
              Demo: choose how the payment stub behaves.
            </Text>
            <Button
              label={
                busy === "success"
                  ? "Paying…"
                  : `Pay ${formatCents(snapshot.totalCents)}`
              }
              onPress={() => void session.pay("success")}
              disabled={!canPay}
            />
            <Button
              secondary
              label={busy === "fail" ? "Paying…" : "Pay (card declined)"}
              onPress={() => void session.pay("fail")}
              disabled={!canPay}
            />
            <Button
              secondary
              label={busy === "slow_success" ? "Paying…" : "Pay (slow, 3s)"}
              onPress={() => void session.pay("slow_success")}
              disabled={!canPay}
            />
          </View>
        )}
    </ScrollView>
  );
}

function StatusBanner({ snapshot }: { snapshot: SessionSnapshot }) {
  switch (snapshot.status) {
    case "completed":
      return (
        <Banner tone="ok" title="Order confirmed">
          {`Your order number is ${snapshot.orderId}.`}
        </Banner>
      );
    case "expired":
      return (
        <Banner tone="danger" title="This checkout has expired">
          {EXPIRY_TEXT[snapshot.failureReason ?? "hold_expired"] ??
            EXPIRY_TEXT.hold_expired}
        </Banner>
      );
    case "completing":
      return (
        <Banner tone="info" title="Payment pending">
          A payment is in progress. This screen updates when it finishes, and
          you can&apos;t pay twice.
        </Banner>
      );
    case "payment_failed":
      return (
        <Banner tone="danger" title="Payment failed">
          Your tickets are still held. Try again before the timer runs out.
        </Banner>
      );
    case "price_changed":
      return (
        <Banner tone="warn" title="A price changed while you were away">
          {snapshot.priceChanges
            .map(
              (c) =>
                `${c.eventName}: ${formatCents(c.quotedPriceCents)} → ${formatCents(c.currentPriceCents)}`,
            )
            .join("\n")}
        </Banner>
      );
    default:
      return null;
  }
}

const TONES = {
  ok: { border: "#1d6a46", background: "rgba(29,106,70,0.15)" },
  info: { border: "#3b82f6", background: "rgba(59,130,246,0.15)" },
  warn: { border: "#d97706", background: "rgba(217,119,6,0.18)" },
  danger: { border: "#dc2626", background: "rgba(220,38,38,0.15)" },
} as const;

function Banner({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  children: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          borderColor: TONES[tone].border,
          backgroundColor: TONES[tone].background,
        },
      ]}
    >
      <Text style={[styles.bold, { color: colors.text }]}>{title}</Text>
      <Text style={{ color: colors.text }}>{children}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  secondary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary
          ? { borderWidth: 1, borderColor: colors.border }
          : { backgroundColor: colors.primary },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  total: { borderTopWidth: 1, paddingTop: 8 },
  itemName: { fontWeight: "500", flexShrink: 1 },
  bold: { fontWeight: "700" },
  strike: { textDecorationLine: "line-through", opacity: 0.6 },
  banner: { borderWidth: 2, borderRadius: 12, padding: 14, gap: 4 },
  pay: { gap: 8, marginTop: 4 },
  button: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
});
