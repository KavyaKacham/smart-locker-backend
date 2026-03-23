/*
  Smart Locker ESP32 Firmware
  Hardware needed:
    - ESP32 board
    - 4x4 Matrix Keypad
    - Relay module (connected to solenoid lock)
    - 2 LEDs (green + red)

  Arduino Libraries to install (Tools > Manage Libraries):
    - Keypad  (by Mark Stanley)
    - ArduinoJson  (by Benoit Blanchon)

  Wiring:
    Keypad ROW pins -> GPIO 13, 12, 14, 27
    Keypad COL pins -> GPIO 26, 25, 33, 32
    Relay signal    -> GPIO 4
    Green LED       -> GPIO 2
    Red LED         -> GPIO 15
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Keypad.h>

// ===== CHANGE THESE 3 THINGS =====
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* BACKEND_URL   = "https://smart-locker-backend-production.up.railway.app";
const int   USER_DB_ID    = 1;   // change to the user's DB id
const int   LOCKER_DB_ID  = 1;   // change to the locker's DB id
// =================================

// These come from the app after user logs in
// Ask your user to check the app and note their numeric ID
const int   USER_DB_ID    = 1;
const int   LOCKER_DB_ID  = 1;
const char* ESP_DEVICE_ID = "ESP32-L001";

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {13, 12, 14, 27};
byte colPins[COLS] = {26, 25, 33, 32};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

const int RELAY_PIN  = 4;
const int LED_GREEN  = 2;
const int LED_RED    = 15;
const int UNLOCK_MS  = 5000;

String enteredOtp = "";

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  connectWiFi();
  Serial.println("Ready. Type 6-digit OTP then press #");
  blinkLED(LED_GREEN, 3);
}

void loop() {
  char key = keypad.getKey();
  if (!key) return;

  if (key == '*') {
    enteredOtp = "";
    Serial.println("Cleared.");
    return;
  }

  if (key == '#') {
    if (enteredOtp.length() == 6) {
      Serial.println("Sending OTP to server...");
      verifyWithBackend(enteredOtp);
    } else {
      Serial.println("Need exactly 6 digits. Press * to clear.");
      blinkLED(LED_RED, 2);
    }
    enteredOtp = "";
    return;
  }

  if (enteredOtp.length() < 6 && isDigit(key)) {
    enteredOtp += key;
    Serial.print("*");
  }
}

void verifyWithBackend(String otp) {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/auth/esp32/verify";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["userId"]      = USER_DB_ID;
  doc["otp"]         = otp;
  doc["lockerId"]    = LOCKER_DB_ID;
  doc["espDeviceId"] = ESP_DEVICE_ID;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.println("Response: " + response);

  if (httpCode == 200) {
    unlockDoor();
  } else {
    accessDenied();
  }
}

void unlockDoor() {
  Serial.println("ACCESS GRANTED - Door opening!");
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(RELAY_PIN, HIGH);
  delay(UNLOCK_MS);
  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(LED_GREEN, LOW);
  Serial.println("Door locked. Enter OTP again to open.");
}

void accessDenied() {
  Serial.println("ACCESS DENIED");
  blinkLED(LED_RED, 4);
}

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi failed!");
  }
}

void blinkLED(int pin, int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH); delay(200);
    digitalWrite(pin, LOW);  delay(200);
  }
}
