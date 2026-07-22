const https = require('https');
require('dotenv').config();

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
    console.error('GROQ_API_KEY is not defined in the environment or .env file.');
    process.exit(1);
}

console.log('Testing Groq API Key (first 5 chars):', apiKey.substring(0, 5) + '...');

const options = {
  hostname: 'api.groq.com',
  path: '/openai/v1/models',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Success: Groq API Key is working!');
      const parsed = JSON.parse(data);
      console.log(`Found ${parsed.data.length} models available.`);
    } else {
      console.log(`❌ Failed: Status Code ${res.statusCode}`);
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error making request:', error);
});

req.end();
