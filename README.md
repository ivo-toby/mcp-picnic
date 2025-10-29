[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/ivo-toby-mcp-picnic-badge.png)](https://mseep.ai/app/ivo-toby-mcp-picnic)

# MCP Picnic - AI-Powered Grocery Shopping Assistant

[![smithery badge](https://smithery.ai/badge/@ivo-toby/mcp-picnic)](https://smithery.ai/server/@ivo-toby/mcp-picnic)

An intelligent Model Context Protocol (MCP) server that enables AI assistants to interact with Picnic, the online supermarket delivery service. This server transforms your AI assistant into a smart grocery shopping companion that can help you plan meals, manage your shopping cart, track deliveries, and optimize your grocery shopping experience.

## What is MCP Picnic?

MCP Picnic is a bridge between AI assistants (like Claude, ChatGPT, or other MCP-compatible tools) and Picnic's grocery delivery service. It provides:

- **🛒 Smart Shopping**: Search products, manage your cart, and place orders through natural conversation
- **🍽️ Meal Planning**: Get AI-powered meal plans with automatic shopping list generation
- **💰 Budget Management**: Shop within your budget with cost-conscious recommendations
- **🚚 Delivery Tracking**: Monitor your orders and optimize delivery schedules
- **🥗 Dietary Support**: Find products that match your dietary restrictions and health goals
- **📱 Complete Integration**: Access all Picnic features through your AI assistant

### Supported Countries

- 🇳🇱 Netherlands
- 🇩🇪 Germany

## Key Features

### 🤖 AI-Powered Shopping Tools

- **Product Search**: Find any product in Picnic's catalog
- **Cart Management**: Add, remove, and modify items in your shopping cart
- **Order Tracking**: Monitor delivery status and driver location
- **Account Management**: Access your profile, payment methods, and order history

### 🎯 Intelligent Prompts

- **Meal Planner**: Create weekly meal plans with automatic shopping lists
- **Budget Shopping**: Stay within budget while maintaining quality
- **Quick Dinners**: Find fast meal solutions for busy schedules
- **Healthy Eating**: Get nutrition-focused product recommendations
- **Special Occasions**: Plan for parties, holidays, and gatherings
- **Pantry Restocking**: Maintain essential household supplies
- **Recipe Recreation**: Find ingredients for specific recipes
- **Dietary Substitutions**: Get alternatives for dietary restrictions

## How to Use

### Prerequisites

- A Picnic account (available in Netherlands or Germany)
- An MCP-compatible AI assistant (Claude Desktop, Continue, etc.)
- Node.js 18+ installed on your system

### Quick Start

1. **Install the server**:

```bash
npm install -g mcp-picnic
```

2. **Configure Claude Desktop** to use the MCP server:

**macOS**: Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: Edit `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "picnic": {
      "command": "npx",
      "args": ["-y", "mcp-picnic"],
      "env": {
        "PICNIC_USERNAME": "your-picnic-email@example.com",
        "PICNIC_PASSWORD": "your-picnic-password",
        "PICNIC_COUNTRY_CODE": "NL"
      }
    }
  }
}
```

**Important**: 
- Replace `your-picnic-email@example.com` and `your-picnic-password` with your actual Picnic account credentials.
- Set `PICNIC_COUNTRY_CODE` to your country: `"NL"` for Netherlands or `"DE"` for Germany (defaults to `"NL"` if not specified).

3. **Restart Claude Desktop** completely

4. **Start using it** - you should see a 🔨 hammer icon in the input area:

```
"I want to plan meals for this week and order groceries from Picnic"
```

### Example Conversations

**Meal Planning**:

```
User: "Plan healthy meals for 2 people for 5 days, budget €75"
AI: I'll help you create a healthy meal plan! First, let me log into your Picnic account...
```

**Quick Shopping**:

```
User: "I need ingredients for pasta carbonara tonight"
AI: Let me search for carbonara ingredients on Picnic and add them to your cart...
```

**Delivery Tracking**:

```
User: "When is my grocery delivery arriving?"
AI: Let me check your current deliveries and their status...
```

## Use Cases

Here are some practical scenarios where MCP Picnic can transform your grocery shopping experience:

### 🍽️ **Smart Meal Planning**

**Scenario**: Planning a week's worth of healthy meals for a family of 4

```
User: "Plan 7 dinners for 4 people, focusing on Mediterranean diet, budget €100"

AI Actions:
1. Uses picnic_search to find Mediterranean ingredients
2. Uses picnic_get_suggestions for recipe ideas
3. Uses picnic_add_to_cart to build shopping list
4. Uses picnic_get_cart to verify total cost
5. Uses picnic_get_delivery_slots to schedule delivery
```

### 🛒 **Intelligent Shopping Assistant**

**Scenario**: Recreating a specific recipe with dietary substitutions

```
User: "I want to make lasagna but need gluten-free and dairy-free alternatives"

AI Actions:
1. Uses picnic_search to find gluten-free pasta
2. Uses picnic_get_suggestions for dairy-free cheese alternatives
3. Uses picnic_get_article to check ingredient details
4. Uses picnic_add_to_cart to add suitable products
5. Provides cooking tips and substitution ratios
```

### 📦 **Delivery Optimization**

**Scenario**: Managing multiple deliveries and tracking orders

```
User: "What's the status of all my orders and when will they arrive?"

AI Actions:
1. Uses picnic_get_deliveries to list all current orders
2. Uses picnic_get_delivery_position for real-time tracking
3. Uses picnic_get_delivery_scenario for driver details
4. Suggests optimal delivery slots using picnic_get_delivery_slots
5. Sends invoice emails using picnic_send_delivery_invoice_email
```

### 💰 **Budget-Conscious Shopping**

**Scenario**: Shopping within a strict budget while maintaining quality

```
User: "I have €50 for groceries this week, help me maximize value"

AI Actions:
1. Uses picnic_search to find budget-friendly staples
2. Uses picnic_get_categories to explore discount sections
3. Uses picnic_get_cart to track running total
4. Uses picnic_remove_from_cart if budget exceeded
5. Uses picnic_get_wallet_transactions to track spending patterns
```

### 🏠 **Household Management**

**Scenario**: Managing shopping lists for different family members

```
User: "Create separate shopping lists for weekly groceries and party supplies"

AI Actions:
1. Uses picnic_get_lists to view existing lists
2. Uses picnic_get_list to check current items
3. Uses picnic_search to find party-specific items
4. Organizes items by category using picnic_get_categories
5. Uses picnic_add_to_cart when ready to order
```

### 🎉 **Event Planning**

**Scenario**: Planning a dinner party for 12 guests

```
User: "I'm hosting a dinner party for 12 people next Saturday, help me plan"

AI Actions:
1. Uses picnic_search to find appetizer, main course, and dessert ingredients
2. Uses picnic_get_suggestions for wine pairings
3. Uses picnic_get_delivery_slots to schedule Friday delivery
4. Uses picnic_set_delivery_slot to book optimal time
5. Uses picnic_get_article to check product availability and sizes
```

### 🥗 **Health & Dietary Management**

**Scenario**: Managing specific dietary requirements (diabetes, allergies)

```
User: "Find low-carb options for a diabetic-friendly weekly menu"

AI Actions:
1. Uses picnic_search with specific dietary keywords
2. Uses picnic_get_article to check nutritional information
3. Uses picnic_get_suggestions for healthy alternatives
4. Uses picnic_add_to_cart for approved items only
5. Tracks nutritional goals across multiple meals
```

### 📱 **Smart Reordering**

**Scenario**: Automatically reordering household essentials

```
User: "Reorder my usual weekly essentials and add some new seasonal items"

AI Actions:
1. Uses picnic_get_user_details to check purchase history
2. Uses picnic_get_wallet_transactions to identify regular purchases
3. Uses picnic_search to find seasonal products
4. Uses picnic_add_to_cart for both regular and new items
5. Uses picnic_get_delivery_slots for convenient scheduling
```

### 🎯 **Price Comparison & Optimization**

**Scenario**: Finding the best value products across categories

```
User: "Compare prices for organic vs conventional produce this week"

AI Actions:
1. Uses picnic_search for both organic and conventional items
2. Uses picnic_get_article to compare prices and sizes
3. Uses picnic_get_categories to explore different brands
4. Uses picnic_get_suggestions for similar products
5. Provides detailed cost analysis and recommendations
```

### 🚚 **Delivery Experience Management**

**Scenario**: Optimizing delivery experience and providing feedback

```
User: "Track my delivery and rate the service quality"

AI Actions:
1. Uses picnic_get_delivery_position for real-time tracking
2. Uses picnic_get_delivery_scenario for driver communication
3. Uses picnic_rate_delivery after completion
4. Uses picnic_send_delivery_invoice_email for records
5. Uses picnic_get_mgm_details to share referral benefits
```

### 💳 **Financial Tracking**

**Scenario**: Managing grocery budget and payment methods

```
User: "Show me my grocery spending patterns and optimize my payment setup"

AI Actions:
1. Uses picnic_get_wallet_transactions for spending analysis
2. Uses picnic_get_wallet_transaction_details for detailed breakdowns
3. Uses picnic_get_payment_profile to review payment methods
4. Provides insights on spending trends and budget optimization
5. Suggests cost-saving strategies based on purchase history
```

These use cases demonstrate how MCP Picnic transforms simple grocery shopping into an intelligent, personalized experience that saves time, money, and effort while ensuring you never miss essential items or optimal deals.

## Setup Instructions

### Option 1: Install from NPM (Recommended)

```bash
# Install globally
npm install -g mcp-picnic

# Or install locally in your project
npm install mcp-picnic
```

### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/ivo-toby/mcp-picnic.git
cd mcp-picnic

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

### Configuration

The server supports both stdio and HTTP transports:

**Stdio Transport (Default)**:

```bash
mcp-picnic
```

**HTTP Transport**:

```bash
mcp-picnic --enable-http --http-port 3000
```

### Environment Variables

You can configure the server using environment variables:

```bash
# Required: Picnic Account Credentials
PICNIC_USERNAME=your-picnic-email@example.com
PICNIC_PASSWORD=your-picnic-password

# HTTP Transport settings (optional)
ENABLE_HTTP_SERVER=true
HTTP_PORT=3000
HTTP_HOST=localhost

# Picnic API settings (optional)
PICNIC_COUNTRY_CODE=NL  # or DE
PICNIC_API_VERSION=15
```

### MCP Client Configuration

#### Claude Desktop

**Configuration File Locations:**

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration:**

```json
{
  "mcpServers": {
    "picnic": {
      "command": "npx",
      "args": ["-y", "mcp-picnic"],
      "env": {
        "PICNIC_USERNAME": "your-picnic-email@example.com",
        "PICNIC_PASSWORD": "your-picnic-password",
        "PICNIC_COUNTRY_CODE": "NL"
      }
    }
  }
}
```

**Important**: 
- Replace the placeholder credentials with your actual Picnic account details.
- Set `PICNIC_COUNTRY_CODE` to your country: `"NL"` for Netherlands or `"DE"` for Germany (defaults to `"NL"` if not specified).

**Setup Steps:**

1. Open Claude Desktop
2. Go to Claude menu → Settings (not the in-app settings)
3. Click "Developer" in the left sidebar
4. Click "Edit Config" to open the configuration file
5. Add the configuration above
6. Save the file and restart Claude Desktop
7. Look for the 🔨 hammer icon in the input area

#### Continue (VS Code)

Add to your Continue configuration:

```json
{
  "mcpServers": [
    {
      "name": "picnic",
      "command": "npx",
      "args": ["-y", "mcp-picnic"],
      "env": {
        "PICNIC_USERNAME": "your-picnic-email@example.com",
        "PICNIC_PASSWORD": "your-picnic-password",
        "PICNIC_COUNTRY_CODE": "NL"
      }
    }
  ]
}
```

**Note**: Set `PICNIC_COUNTRY_CODE` to `"NL"` for Netherlands or `"DE"` for Germany (defaults to `"NL"` if not specified).

## Authentication

The server uses the credentials configured in your environment variables:

1. **Required**: Set `PICNIC_USERNAME` and `PICNIC_PASSWORD` in your MCP configuration
2. **2FA Support**: If 2FA is enabled on your account, the server will handle verification automatically
3. **Session Management**: Your session will be maintained for subsequent requests

**Security Note**: Your credentials are only used to authenticate with Picnic's API and are not stored permanently. They are passed securely through environment variables.

## Available Tools

The server provides comprehensive access to Picnic's functionality through 25+ specialized tools:

### Authentication & Account Management

- **`picnic_generate_2fa_code`** - Generate 2FA verification code (SMS/other channels)
- **`picnic_verify_2fa_code`** - Verify 2FA code for authentication
- **`picnic_get_user_details`** - Get current user profile information
- **`picnic_get_user_info`** - Get user information including feature toggles

**Note**: Authentication is handled automatically using credentials from environment variables (`PICNIC_USERNAME` and `PICNIC_PASSWORD`). No manual login is required.

### Product Discovery & Search

- **`picnic_search`** - Search for products by name or keywords
- **`picnic_get_suggestions`** - Get product suggestions based on query
- **`picnic_get_article`** - Get detailed information about a specific product
- **`picnic_get_image`** - Get product images in various sizes (tiny to extra-large)
- **`picnic_get_categories`** - Browse product categories with configurable depth

### Shopping Cart Management

- **`picnic_get_cart`** - View current shopping cart contents and totals
- **`picnic_add_to_cart`** - Add products to cart with specified quantities
- **`picnic_remove_from_cart`** - Remove products from cart with specified quantities
- **`picnic_clear_cart`** - Clear all items from the shopping cart

### Delivery & Order Management

- **`picnic_get_delivery_slots`** - View available delivery time slots
- **`picnic_set_delivery_slot`** - Select and book a delivery time slot
- **`picnic_get_deliveries`** - Get list of past and current deliveries with filters
- **`picnic_get_delivery`** - Get detailed information about a specific delivery
- **`picnic_get_delivery_position`** - Track real-time driver location and ETA
- **`picnic_get_delivery_scenario`** - Get driver and route information
- **`picnic_cancel_delivery`** - Cancel a scheduled delivery
- **`picnic_rate_delivery`** - Rate completed deliveries (0-10 scale)
- **`picnic_send_delivery_invoice_email`** - Send/resend delivery invoice emails
- **`picnic_get_order_status`** - Check status of specific orders

### Lists & Organization

- **`picnic_get_lists`** - Get shopping lists and sublists with configurable depth
- **`picnic_get_list`** - Get specific list or sublist with all items

### Payment & Financial

- **`picnic_get_payment_profile`** - View payment methods and billing information
- **`picnic_get_wallet_transactions`** - Get wallet transaction history (paginated)
- **`picnic_get_wallet_transaction_details`** - Get detailed transaction information
- **`picnic_get_mgm_details`** - Get MGM (friends discount) program details

## Development

### Running in Development Mode

```bash
# Clone and setup
git clone https://github.com/ivo-toby/mcp-picnic.git
cd mcp-picnic
npm install

# Development with hot reload
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Project Structure

```
src/
├── index.ts              # Main server entry point
├── config.ts             # Configuration management
├── tools/                # Picnic API tool implementations
├── prompts/              # AI prompt templates
├── resources/            # Resource definitions
├── handlers/             # Request handlers
├── transports/           # Transport layer (stdio/HTTP)
└── utils/                # Utility functions
```

## Contributing

We welcome contributions! Please see our [contributing guidelines](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://github.com/ivo-toby/mcp-picnic/wiki)
- 🐛 [Report Issues](https://github.com/ivo-toby/mcp-picnic/issues)
- 💬 [Discussions](https://github.com/ivo-toby/mcp-picnic/discussions)

---

# MCP Picnic - AI-Gestuurde Boodschappen Assistent (Nederlands)

Een intelligente Model Context Protocol (MCP) server die AI-assistenten in staat stelt om te communiceren met Picnic, de online supermarkt bezorgservice. Deze server transformeert je AI-assistent in een slimme boodschappen-companion die je kan helpen met maaltijdplanning, het beheren van je winkelwagen, het volgen van leveringen, en het optimaliseren van je boodschappen-ervaring.

## Wat is MCP Picnic?

MCP Picnic is een brug tussen AI-assistenten (zoals Claude, ChatGPT, of andere MCP-compatibele tools) en Picnic's bezorgservice voor boodschappen. Het biedt:

- **🛒 Slim Winkelen**: Zoek producten, beheer je winkelwagen, en plaats bestellingen via natuurlijke conversatie
- **🍽️ Maaltijdplanning**: Krijg AI-gestuurde maaltijdplannen met automatische boodschappenlijst generatie
- **💰 Budget Beheer**: Shop binnen je budget met kostenefficiënte aanbevelingen
- **🚚 Bezorging Volgen**: Monitor je bestellingen en optimaliseer bezorgschema's
- **🥗 Dieet Ondersteuning**: Vind producten die passen bij je dieetbeperkingen en gezondheidsdoelen
- **📱 Volledige Integratie**: Toegang tot alle Picnic functies via je AI-assistent

### Ondersteunde Landen

- 🇳🇱 Nederland
- 🇩🇪 Duitsland

## Belangrijkste Functies

### 🤖 AI-Gestuurde Winkel Tools

- **Product Zoeken**: Vind elk product in Picnic's catalogus
- **Winkelwagen Beheer**: Voeg toe, verwijder, en wijzig items in je winkelwagen
- **Bestelling Volgen**: Monitor bezorgstatus en chauffeur locatie
- **Account Beheer**: Toegang tot je profiel, betaalmethoden, en bestelgeschiedenis

### 🎯 Intelligente Prompts

- **Maaltijdplanner**: Creëer wekelijkse maaltijdplannen met automatische boodschappenlijsten
- **Budget Winkelen**: Blijf binnen budget terwijl je kwaliteit behoudt
- **Snelle Diners**: Vind snelle maaltijdoplossingen voor drukke schema's
- **Gezond Eten**: Krijg voeding-gerichte productaanbevelingen
- **Speciale Gelegenheden**: Plan voor feesten, vakanties, en bijeenkomsten
- **Voorraadkast Aanvullen**: Onderhoud essentiële huishoudelijke benodigdheden
- **Recept Recreatie**: Vind ingrediënten voor specifieke recepten
- **Dieet Vervangingen**: Krijg alternatieven voor dieetbeperkingen

## Hoe te Gebruiken

### Vereisten

- Een Picnic account (beschikbaar in Nederland of Duitsland)
- Een MCP-compatibele AI-assistent (Claude Desktop, Continue, etc.)
- Node.js 18+ geïnstalleerd op je systeem

### Snelle Start

1. **Installeer de server**:

```bash
npm install -g mcp-picnic
```

2. **Configureer Claude Desktop** om de MCP server te gebruiken:

**macOS**: Bewerk `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: Bewerk `%APPDATA%\Claude\claude_desktop_config.json`

Voeg deze configuratie toe:

```json
{
  "mcpServers": {
    "picnic": {
      "command": "npx",
      "args": ["-y", "mcp-picnic"],
      "env": {
        "PICNIC_USERNAME": "jouw-picnic-email@example.com",
        "PICNIC_PASSWORD": "jouw-picnic-wachtwoord"
      }
    }
  }
}
```

**Belangrijk**: Vervang `jouw-picnic-email@example.com` en `jouw-picnic-wachtwoord` met je echte Picnic account gegevens.

3. **Herstart Claude Desktop** volledig

4. **Begin met gebruiken** - je zou een 🔨 hamer icoon moeten zien in het invoerveld:

```
"Ik wil maaltijden plannen voor deze week en boodschappen bestellen bij Picnic"
```

## Setup Instructies

### Optie 1: Installeer van NPM (Aanbevolen)

```bash
# Installeer globaal
npm install -g mcp-picnic

# Of installeer lokaal in je project
npm install mcp-picnic
```

### Optie 2: Bouw van Bron

```bash
# Kloon de repository
git clone https://github.com/ivo-toby/mcp-picnic.git
cd mcp-picnic

# Installeer dependencies
npm install

# Bouw het project
npm run build

# Link globaal (optioneel)
npm link
```

## Authenticatie

De server gebruikt de inloggegevens die geconfigureerd zijn in je omgevingsvariabelen:

1. **Vereist**: Stel `PICNIC_USERNAME` en `PICNIC_PASSWORD` in je MCP configuratie in
2. **2FA Ondersteuning**: Als 2FA is ingeschakeld op je account, handelt de server verificatie automatisch af
3. **Sessiebeheer**: Je sessie wordt onderhouden voor volgende verzoeken

**Beveiligingsnotitie**: Je inloggegevens worden alleen gebruikt om te authenticeren met Picnic's API en worden niet permanent opgeslagen. Ze worden veilig doorgegeven via omgevingsvariabelen.

## Gebruiksscenario's

Hier zijn enkele praktische scenario's waarin MCP Picnic je boodschappen-ervaring kan transformeren:

### 🍽️ **Slimme Maaltijdplanning**

**Scenario**: Een week vol gezonde maaltijden plannen voor een gezin van 4

```
Gebruiker: "Plan 7 avondmaaltijden voor 4 personen, focus op mediterraan dieet, budget €100"

AI Acties:
1. Gebruikt picnic_search om mediterrane ingrediënten te vinden
2. Gebruikt picnic_get_suggestions voor recept ideeën
3. Gebruikt picnic_add_to_cart om boodschappenlijst op te bouwen
4. Gebruikt picnic_get_cart om totale kosten te verifiëren
5. Gebruikt picnic_get_delivery_slots om bezorging in te plannen
```

### 🛒 **Intelligente Boodschappen Assistent**

**Scenario**: Een specifiek recept recreëren met dieet vervangingen

```
Gebruiker: "Ik wil lasagne maken maar heb glutenvrije en zuivelvrije alternatieven nodig"

AI Acties:
1. Gebruikt picnic_search om glutenvrije pasta te vinden
2. Gebruikt picnic_get_suggestions voor zuivelvrije kaas alternatieven
3. Gebruikt picnic_get_article om ingrediënt details te controleren
4. Gebruikt picnic_add_to_cart om geschikte producten toe te voegen
5. Geeft kooktips en vervangingsverhoudingen
```

### 📦 **Bezorging Optimalisatie**

**Scenario**: Meerdere bezorgingen beheren en bestellingen volgen

```
Gebruiker: "Wat is de status van al mijn bestellingen en wanneer komen ze aan?"

AI Acties:
1. Gebruikt picnic_get_deliveries om alle huidige bestellingen te tonen
2. Gebruikt picnic_get_delivery_position voor real-time tracking
3. Gebruikt picnic_get_delivery_scenario voor chauffeur details
4. Stelt optimale bezorgtijden voor met picnic_get_delivery_slots
5. Verstuurt factuur emails met picnic_send_delivery_invoice_email
```

### 💰 **Budget-Bewust Winkelen**

**Scenario**: Winkelen binnen een strikt budget terwijl kwaliteit behouden blijft

```
Gebruiker: "Ik heb €50 voor boodschappen deze week, help me de waarde te maximaliseren"

AI Acties:
1. Gebruikt picnic_search om budget-vriendelijke basisproducten te vinden
2. Gebruikt picnic_get_categories om kortingssecties te verkennen
3. Gebruikt picnic_get_cart om lopend totaal bij te houden
4. Gebruikt picnic_remove_from_cart als budget overschreden wordt
5. Gebruikt picnic_get_wallet_transactions om uitgavenpatronen te volgen
```

### 🏠 **Huishouden Beheer**

**Scenario**: Boodschappenlijsten beheren voor verschillende gezinsleden

```
Gebruiker: "Maak aparte boodschappenlijsten voor wekelijkse boodschappen en feestbenodigdheden"

AI Acties:
1. Gebruikt picnic_get_lists om bestaande lijsten te bekijken
2. Gebruikt picnic_get_list om huidige items te controleren
3. Gebruikt picnic_search om feest-specifieke items te vinden
4. Organiseert items per categorie met picnic_get_categories
5. Gebruikt picnic_add_to_cart wanneer klaar om te bestellen
```

### 🎉 **Evenement Planning**

**Scenario**: Een dinerfeest plannen voor 12 gasten

```
Gebruiker: "Ik organiseer een dinerfeest voor 12 personen aanstaande zaterdag, help me plannen"

AI Acties:
1. Gebruikt picnic_search om voorgerechten, hoofdgerechten en dessert ingrediënten te vinden
2. Gebruikt picnic_get_suggestions voor wijn combinaties
3. Gebruikt picnic_get_delivery_slots om vrijdag bezorging in te plannen
4. Gebruikt picnic_set_delivery_slot om optimale tijd te boeken
5. Gebruikt picnic_get_article om product beschikbaarheid en maten te controleren
```

### 🥗 **Gezondheid & Dieet Beheer**

**Scenario**: Specifieke dieetvereisten beheren (diabetes, allergieën)

```
Gebruiker: "Vind koolhydraatarme opties voor een diabetesvriendelijk weekmenu"

AI Acties:
1. Gebruikt picnic_search met specifieke dieet zoekwoorden
2. Gebruikt picnic_get_article om voedingswaarde informatie te controleren
3. Gebruikt picnic_get_suggestions voor gezonde alternatieven
4. Gebruikt picnic_add_to_cart alleen voor goedgekeurde items
5. Volgt voedingsdoelen over meerdere maaltijden
```

### 📱 **Slimme Herbestelling**

**Scenario**: Automatisch herbestellen van huishoudelijke essentials

```
Gebruiker: "Bestel mijn gebruikelijke wekelijkse essentials opnieuw en voeg wat nieuwe seizoensproducten toe"

AI Acties:
1. Gebruikt picnic_get_user_details om aankoopgeschiedenis te controleren
2. Gebruikt picnic_get_wallet_transactions om reguliere aankopen te identificeren
3. Gebruikt picnic_search om seizoensproducten te vinden
4. Gebruikt picnic_add_to_cart voor zowel reguliere als nieuwe items
5. Gebruikt picnic_get_delivery_slots voor handige planning
```

### 🎯 **Prijsvergelijking & Optimalisatie**

**Scenario**: De beste waarde producten vinden in verschillende categorieën

```
Gebruiker: "Vergelijk prijzen voor biologische vs conventionele groenten deze week"

AI Acties:
1. Gebruikt picnic_search voor zowel biologische als conventionele items
2. Gebruikt picnic_get_article om prijzen en maten te vergelijken
3. Gebruikt picnic_get_categories om verschillende merken te verkennen
4. Gebruikt picnic_get_suggestions voor vergelijkbare producten
5. Geeft gedetailleerde kostenanalyse en aanbevelingen
```

### 🚚 **Bezorgervaring Beheer**

**Scenario**: Bezorgervaring optimaliseren en feedback geven

```
Gebruiker: "Volg mijn bezorging en beoordeel de servicekwaliteit"

AI Acties:
1. Gebruikt picnic_get_delivery_position voor real-time tracking
2. Gebruikt picnic_get_delivery_scenario voor chauffeur communicatie
3. Gebruikt picnic_rate_delivery na voltooiing
4. Gebruikt picnic_send_delivery_invoice_email voor administratie
5. Gebruikt picnic_get_mgm_details om doorverwijsvoordelen te delen
```

### 💳 **Financiële Tracking**

**Scenario**: Boodschappenbudget beheren en betalingsmethoden optimaliseren

```
Gebruiker: "Toon me mijn boodschappen uitgavenpatronen en optimaliseer mijn betalingsinstellingen"

AI Acties:
1. Gebruikt picnic_get_wallet_transactions voor uitgavenanalyse
2. Gebruikt picnic_get_wallet_transaction_details voor gedetailleerde uitsplitsingen
3. Gebruikt picnic_get_payment_profile om betalingsmethoden te bekijken
4. Geeft inzichten over uitgaventrends en budget optimalisatie
5. Stelt kostenbesparende strategieën voor gebaseerd op aankoopgeschiedenis
```

Deze gebruiksscenario's tonen hoe MCP Picnic eenvoudige boodschappen doen transformeert in een intelligente, gepersonaliseerde ervaring die tijd, geld en moeite bespaart terwijl je nooit essentiële items of optimale aanbiedingen mist.

---

# MCP Picnic - KI-Gesteuerte Lebensmittel-Einkaufsassistent (Deutsch)

Ein intelligenter Model Context Protocol (MCP) Server, der KI-Assistenten ermöglicht, mit Picnic, dem Online-Supermarkt-Lieferservice, zu interagieren. Dieser Server verwandelt Ihren KI-Assistenten in einen intelligenten Einkaufsbegleiter, der Ihnen bei der Mahlzeitenplanung, der Verwaltung Ihres Einkaufswagens, der Verfolgung von Lieferungen und der Optimierung Ihres Einkaufserlebnisses helfen kann.

## Was ist MCP Picnic?

MCP Picnic ist eine Brücke zwischen KI-Assistenten (wie Claude, ChatGPT oder anderen MCP-kompatiblen Tools) und Picnics Lebensmittel-Lieferservice. Es bietet:

- **🛒 Intelligentes Einkaufen**: Suchen Sie Produkte, verwalten Sie Ihren Warenkorb und geben Sie Bestellungen über natürliche Unterhaltung auf
- **🍽️ Mahlzeitenplanung**: Erhalten Sie KI-gesteuerte Mahlzeitenpläne mit automatischer Einkaufslistenerstellung
- **💰 Budget-Management**: Kaufen Sie innerhalb Ihres Budgets mit kostenbewussten Empfehlungen ein
- **🚚 Lieferverfolgung**: Überwachen Sie Ihre Bestellungen und optimieren Sie Lieferpläne
- **🥗 Diät-Unterstützung**: Finden Sie Produkte, die zu Ihren Ernährungseinschränkungen und Gesundheitszielen passen
- **📱 Vollständige Integration**: Zugriff auf alle Picnic-Funktionen über Ihren KI-Assistenten

### Unterstützte Länder

- 🇳🇱 Niederlande
- 🇩🇪 Deutschland

## Hauptfunktionen

### 🤖 KI-Gesteuerte Einkaufs-Tools

- **Produktsuche**: Finden Sie jedes Produkt in Picnics Katalog
- **Warenkorbverwaltung**: Hinzufügen, entfernen und ändern Sie Artikel in Ihrem Warenkorb
- **Bestellverfolgung**: Überwachen Sie Lieferstatus und Fahrerstandort
- **Kontoverwaltung**: Zugriff auf Ihr Profil, Zahlungsmethoden und Bestellhistorie

### 🎯 Intelligente Prompts

- **Mahlzeitenplaner**: Erstellen Sie wöchentliche Mahlzeitenpläne mit automatischen Einkaufslisten
- **Budget-Einkauf**: Bleiben Sie im Budget und behalten dabei die Qualität bei
- **Schnelle Abendessen**: Finden Sie schnelle Mahlzeitenlösungen für geschäftige Zeitpläne
- **Gesunde Ernährung**: Erhalten Sie ernährungsorientierte Produktempfehlungen
- **Besondere Anlässe**: Planen Sie für Partys, Feiertage und Versammlungen
- **Vorratskammer-Auffüllung**: Pflegen Sie wesentliche Haushaltsvorräte
- **Rezept-Nachstellung**: Finden Sie Zutaten für spezifische Rezepte
- **Diät-Ersatz**: Erhalten Sie Alternativen für Ernährungseinschränkungen

## Wie zu Verwenden

### Voraussetzungen

- Ein Picnic-Konto (verfügbar in den Niederlanden oder Deutschland)
- Ein MCP-kompatibler KI-Assistent (Claude Desktop, Continue, etc.)
- Node.js 18+ auf Ihrem System installiert

### Schnellstart

1. **Installieren Sie den Server**:

```bash
npm install -g mcp-picnic
```

2. **Konfigurieren Sie Claude Desktop**, um den MCP-Server zu verwenden:

**macOS**: Bearbeiten Sie `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: Bearbeiten Sie `%APPDATA%\Claude\claude_desktop_config.json`

Fügen Sie diese Konfiguration hinzu:

```json
{
  "mcpServers": {
    "picnic": {
      "command": "npx",
      "args": ["-y", "mcp-picnic"],
      "env": {
        "PICNIC_USERNAME": "ihre-picnic-email@example.com",
        "PICNIC_PASSWORD": "ihr-picnic-passwort"
      }
    }
  }
}
```

**Wichtig**: Ersetzen Sie `ihre-picnic-email@example.com` und `ihr-picnic-passwort` mit Ihren tatsächlichen Picnic-Kontodaten.

3. **Starten Sie Claude Desktop** vollständig neu

4. **Beginnen Sie mit der Nutzung** - Sie sollten ein 🔨 Hammer-Symbol im Eingabebereich sehen:

```
"Ich möchte Mahlzeiten für diese Woche planen und Lebensmittel bei Picnic bestellen"
```

## Setup-Anweisungen

### Option 1: Von NPM installieren (Empfohlen)

```bash
# Global installieren
npm install -g mcp-picnic

# Oder lokal in Ihrem Projekt installieren
npm install mcp-picnic
```

### Option 2: Aus Quelle erstellen

```bash
# Repository klonen
git clone https://github.com/ivo-toby/mcp-picnic.git
cd mcp-picnic

# Abhängigkeiten installieren
npm install

# Projekt erstellen
npm run build

# Global verknüpfen (optional)
npm link
```

## Authentifizierung

Der Server verwendet die in Ihren Umgebungsvariablen konfigurierten Anmeldedaten:

1. **Erforderlich**: Setzen Sie `PICNIC_USERNAME` und `PICNIC_PASSWORD` in Ihrer MCP-Konfiguration
2. **2FA-Unterstützung**: Wenn 2FA auf Ihrem Konto aktiviert ist, handhabt der Server die Verifizierung automatisch
3. **Sitzungsverwaltung**: Ihre Sitzung wird für nachfolgende Anfragen beibehalten

**Sicherheitshinweis**: Ihre Anmeldedaten werden nur zur Authentifizierung mit Picnics API verwendet und nicht dauerhaft gespeichert. Sie werden sicher über Umgebungsvariablen übertragen.

## Anwendungsfälle

Hier sind einige praktische Szenarien, in denen MCP Picnic Ihr Lebensmitteleinkaufserlebnis transformieren kann:

### 🍽️ **Intelligente Mahlzeitenplanung**

**Szenario**: Eine Woche voller gesunder Mahlzeiten für eine 4-köpfige Familie planen

```
Benutzer: "Plane 7 Abendessen für 4 Personen, Fokus auf mediterrane Diät, Budget €100"

KI-Aktionen:
1. Verwendet picnic_search um mediterrane Zutaten zu finden
2. Verwendet picnic_get_suggestions für Rezeptideen
3. Verwendet picnic_add_to_cart um Einkaufsliste zu erstellen
4. Verwendet picnic_get_cart um Gesamtkosten zu überprüfen
5. Verwendet picnic_get_delivery_slots um Lieferung zu planen
```

### 🛒 **Intelligenter Einkaufsassistent**

**Szenario**: Ein spezifisches Rezept mit Diät-Ersatzstoffen nachkochen

```
Benutzer: "Ich möchte Lasagne machen, brauche aber glutenfreie und milchfreie Alternativen"

KI-Aktionen:
1. Verwendet picnic_search um glutenfreie Pasta zu finden
2. Verwendet picnic_get_suggestions für milchfreie Käse-Alternativen
3. Verwendet picnic_get_article um Zutatdetails zu prüfen
4. Verwendet picnic_add_to_cart um geeignete Produkte hinzuzufügen
5. Gibt Kochtipps und Ersatzverhältnisse
```

### 📦 **Lieferoptimierung**

**Szenario**: Mehrere Lieferungen verwalten und Bestellungen verfolgen

```
Benutzer: "Wie ist der Status all meiner Bestellungen und wann kommen sie an?"

KI-Aktionen:
1. Verwendet picnic_get_deliveries um alle aktuellen Bestellungen anzuzeigen
2. Verwendet picnic_get_delivery_position für Echtzeit-Tracking
3. Verwendet picnic_get_delivery_scenario für Fahrerdetails
4. Schlägt optimale Lieferzeiten mit picnic_get_delivery_slots vor
5. Sendet Rechnungs-E-Mails mit picnic_send_delivery_invoice_email
```

### 💰 **Budgetbewusstes Einkaufen**

**Szenario**: Innerhalb eines strengen Budgets einkaufen und dabei Qualität beibehalten

```
Benutzer: "Ich habe €50 für Lebensmittel diese Woche, hilf mir den Wert zu maximieren"

KI-Aktionen:
1. Verwendet picnic_search um budgetfreundliche Grundnahrungsmittel zu finden
2. Verwendet picnic_get_categories um Rabattbereiche zu erkunden
3. Verwendet picnic_get_cart um laufende Gesamtsumme zu verfolgen
4. Verwendet picnic_remove_from_cart wenn Budget überschritten wird
5. Verwendet picnic_get_wallet_transactions um Ausgabenmuster zu verfolgen
```

### 🏠 **Haushaltsmanagement**

**Szenario**: Einkaufslisten für verschiedene Familienmitglieder verwalten

```
Benutzer: "Erstelle separate Einkaufslisten für wöchentliche Lebensmittel und Partybedarf"

KI-Aktionen:
1. Verwendet picnic_get_lists um bestehende Listen anzuzeigen
2. Verwendet picnic_get_list um aktuelle Artikel zu überprüfen
3. Verwendet picnic_search um party-spezifische Artikel zu finden
4. Organisiert Artikel nach Kategorien mit picnic_get_categories
5. Verwendet picnic_add_to_cart wenn bereit zum Bestellen
```

### 🎉 **Veranstaltungsplanung**

**Szenario**: Ein Abendessen für 12 Gäste planen

```
Benutzer: "Ich veranstalte ein Abendessen für 12 Personen nächsten Samstag, hilf mir planen"

KI-Aktionen:
1. Verwendet picnic_search um Vorspeisen, Hauptgerichte und Dessert-Zutaten zu finden
2. Verwendet picnic_get_suggestions für Weinpaarungen
3. Verwendet picnic_get_delivery_slots um Freitag-Lieferung zu planen
4. Verwendet picnic_set_delivery_slot um optimale Zeit zu buchen
5. Verwendet picnic_get_article um Produktverfügbarkeit und Größen zu prüfen
```

### 🥗 **Gesundheits- & Diätmanagement**

**Szenario**: Spezifische Diätanforderungen verwalten (Diabetes, Allergien)

```
Benutzer: "Finde kohlenhydratarme Optionen für ein diabetikerfreundliches Wochenmenü"

KI-Aktionen:
1. Verwendet picnic_search mit spezifischen Diät-Suchbegriffen
2. Verwendet picnic_get_article um Nährwertinformationen zu prüfen
3. Verwendet picnic_get_suggestions für gesunde Alternativen
4. Verwendet picnic_add_to_cart nur für genehmigte Artikel
5. Verfolgt Ernährungsziele über mehrere Mahlzeiten
```

### 📱 **Intelligente Nachbestellung**

**Szenario**: Automatische Nachbestellung von Haushaltsessentials

```
Benutzer: "Bestelle meine üblichen wöchentlichen Essentials nach und füge neue saisonale Artikel hinzu"

KI-Aktionen:
1. Verwendet picnic_get_user_details um Kaufhistorie zu prüfen
2. Verwendet picnic_get_wallet_transactions um regelmäßige Käufe zu identifizieren
3. Verwendet picnic_search um saisonale Produkte zu finden
4. Verwendet picnic_add_to_cart für sowohl reguläre als auch neue Artikel
5. Verwendet picnic_get_delivery_slots für bequeme Planung
```

### 🎯 **Preisvergleich & Optimierung**

**Szenario**: Die besten Wertprodukte in verschiedenen Kategorien finden

```
Benutzer: "Vergleiche Preise für Bio- vs. konventionelles Gemüse diese Woche"

KI-Aktionen:
1. Verwendet picnic_search für sowohl Bio- als auch konventionelle Artikel
2. Verwendet picnic_get_article um Preise und Größen zu vergleichen
3. Verwendet picnic_get_categories um verschiedene Marken zu erkunden
4. Verwendet picnic_get_suggestions für ähnliche Produkte
5. Bietet detaillierte Kostenanalyse und Empfehlungen
```

### 🚚 **Liefererfahrungsmanagement**

**Szenario**: Liefererfahrung optimieren und Feedback geben

```
Benutzer: "Verfolge meine Lieferung und bewerte die Servicequalität"

KI-Aktionen:
1. Verwendet picnic_get_delivery_position für Echtzeit-Tracking
2. Verwendet picnic_get_delivery_scenario für Fahrerkommunikation
3. Verwendet picnic_rate_delivery nach Abschluss
4. Verwendet picnic_send_delivery_invoice_email für Aufzeichnungen
5. Verwendet picnic_get_mgm_details um Empfehlungsvorteile zu teilen
```

### 💳 **Finanzielle Verfolgung**

**Szenario**: Lebensmittelbudget verwalten und Zahlungsmethoden optimieren

```
Benutzer: "Zeige mir meine Lebensmittelausgabenmuster und optimiere meine Zahlungseinstellungen"

KI-Aktionen:
1. Verwendet picnic_get_wallet_transactions für Ausgabenanalyse
2. Verwendet picnic_get_wallet_transaction_details für detaillierte Aufschlüsselungen
3. Verwendet picnic_get_payment_profile um Zahlungsmethoden zu überprüfen
4. Bietet Einblicke in Ausgabentrends und Budgetoptimierung
5. Schlägt kostensparende Strategien basierend auf Kaufhistorie vor
```

Diese Anwendungsfälle zeigen, wie MCP Picnic einfaches Lebensmitteleinkaufen in eine intelligente, personalisierte Erfahrung verwandelt, die Zeit, Geld und Aufwand spart und dabei sicherstellt, dass Sie nie wichtige Artikel oder optimale Angebote verpassen.
