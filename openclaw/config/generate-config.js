const fs = require('fs');
const path = require('path');

try {
  const templatePath = path.join(__dirname, 'openclaw.template.json');
  const outputPath = process.env.OPENCLAW_CONFIG_PATH || path.join(__dirname, 'openclaw.json');

  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found at ${templatePath}`);
    process.exit(1);
  }

  let content = fs.readFileSync(templatePath, 'utf8');

  // Replace environment variable placeholders like ${VAR_NAME}
  content = content.replace(/\${(\w+)}/g, (match, key) => {
    return process.env[key] !== undefined ? process.env[key] : '';
  });

  // Replace __DISCORD_ENABLED__ placeholder with boolean true or false
  const discordEnabled = process.env.DISCORD_ENABLED === 'true' ? 'true' : 'false';
  content = content.replace(/"__DISCORD_ENABLED__"/g, discordEnabled);

  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Successfully generated openclaw.json configuration at ${outputPath}`);
} catch (error) {
  console.error('Failed to generate OpenClaw configuration:', error);
  process.exit(1);
}
