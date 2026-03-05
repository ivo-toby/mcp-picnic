#!/usr/bin/env node
/**
 * Debug script to inspect the Picnic 2FA flow and check what headers are returned.
 * Usage: node scripts/debug-2fa.mjs
 *
 * Set PICNIC_USERNAME, PICNIC_PASSWORD, and optionally PICNIC_COUNTRY_CODE in env or .env
 */
import crypto from "crypto"
import dotenv from "dotenv"
import readline from "readline"

dotenv.config()

const username = process.env.PICNIC_USERNAME
const password = process.env.PICNIC_PASSWORD
const countryCode = (process.env.PICNIC_COUNTRY_CODE || "NL").toLowerCase()
const url = `https://storefront-prod.${countryCode}.picnicinternational.com/api/15`

if (!username || !password) {
  console.error("Set PICNIC_USERNAME and PICNIC_PASSWORD env vars")
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((resolve) => rl.question(q, resolve))

async function main() {
  // Step 1: Login
  console.log("\n=== Step 1: Login ===")
  const secret = crypto.createHash("md5").update(password, "utf8").digest("hex")
  const loginRes = await fetch(`${url}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: username, secret, client_id: 30100 }),
  })

  console.log("Login status:", loginRes.status)
  console.log("Login headers:")
  for (const [key, value] of loginRes.headers.entries()) {
    console.log(`  ${key}: ${key === "x-picnic-auth" ? value : value.substring(0, 80)}`)
  }

  const loginData = await loginRes.json()
  const authKey = loginRes.headers.get("x-picnic-auth")
  console.log("Login body:", JSON.stringify(loginData, null, 2))
  console.log("Auth key:", authKey)

  if (!loginData.second_factor_authentication_required) {
    console.log("\n2FA not required, testing cart...")
    await testCart(authKey)
    rl.close()
    return
  }

  // Step 2: Generate 2FA
  console.log("\n=== Step 2: Generate 2FA ===")
  const genRes = await fetch(`${url}/user/2fa/generate`, {
    method: "POST",
    headers: {
      "User-Agent": "okhttp/3.12.2",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": authKey,
      "x-picnic-agent": "30100;1.15.232-15154",
      "x-picnic-did": "3C417201548B2E3B",
    },
    body: JSON.stringify({ channel: "SMS" }),
  })

  console.log("Generate 2FA status:", genRes.status)
  console.log("Generate 2FA headers:")
  for (const [key, value] of genRes.headers.entries()) {
    console.log(`  ${key}: ${value.substring(0, 80)}`)
  }
  const genBody = await genRes.text()
  console.log("Generate 2FA body:", genBody || "(empty)")

  // Step 3: Verify 2FA
  const code = await ask("\nEnter the 2FA code you received: ")

  console.log("\n=== Step 3: Verify 2FA ===")
  const verifyRes = await fetch(`${url}/user/2fa/verify`, {
    method: "POST",
    headers: {
      "User-Agent": "okhttp/3.12.2",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": authKey,
      "x-picnic-agent": "30100;1.15.232-15154",
      "x-picnic-did": "3C417201548B2E3B",
    },
    body: JSON.stringify({ otp: code }),
  })

  console.log("Verify 2FA status:", verifyRes.status)
  console.log("Verify 2FA headers:")
  for (const [key, value] of verifyRes.headers.entries()) {
    console.log(`  ${key}: ${value.substring(0, 80)}`)
  }
  const verifyBody = await verifyRes.text()
  console.log("Verify 2FA body:", verifyBody || "(empty)")

  const newAuthKey = verifyRes.headers.get("x-picnic-auth")
  console.log("\nNew auth key from verify:", newAuthKey || "(none)")
  console.log("Auth key changed:", newAuthKey && newAuthKey !== authKey ? "YES" : "NO")

  // Step 4: Test cart with both keys
  const keyToUse = newAuthKey || authKey
  console.log("\n=== Step 4: Test cart ===")
  await testCart(keyToUse)

  if (newAuthKey && newAuthKey !== authKey) {
    console.log("\n=== Step 4b: Test cart with OLD key (should fail) ===")
    await testCart(authKey)
  }

  rl.close()
}

async function testCart(key) {
  const cartRes = await fetch(`${url}/cart`, {
    method: "GET",
    headers: {
      "User-Agent": "okhttp/3.12.2",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": key,
    },
  })
  console.log("Cart status:", cartRes.status)
  if (cartRes.ok) {
    const cartData = await cartRes.json()
    console.log("Cart items:", cartData.items?.length ?? "unknown")
  } else {
    const errBody = await cartRes.text()
    console.log("Cart error:", errBody.substring(0, 200))
  }
}

main().catch(console.error)
