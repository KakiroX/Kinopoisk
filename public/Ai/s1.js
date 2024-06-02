// Import necessary packages
const express = require('express');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require("@openai/client");

// Initialize express app
const app = express();
const port = 3000;

// Middlewares
app.use(bodyParser.json()); // for parsing application/json

// Replace 'YOUR_API_KEY' with your actual OpenAI API key
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY || "", // It's safer to use an environment variable for the API key
});
const openai = new OpenAIApi(configuration);

// Serve HTML file
app.get('/', (req, res) => {
    res.sendFile("public\Ai\h1.html");
});

// /chatgpt-topics endpoint to handle POST request
app.post('/chatgpt-topics', async (req, res) => {
    const { grade, subject } = req.body; // Extract grade and subject from the request body

    // Check if grade and subject are provided
    if (!grade || !subject) {
        return res.status(400).send('Grade and subject are required.');
    }

    try {
        // Generate prompt for OpenAI API
        const prompt = `Generate a list of study topics for a ${grade}th grade student studying ${subject}.`;

        // Call OpenAI API
        const response = await openai.createCompletion({
            model: "gpt-3.5-turbo", // Or use the latest available model
            prompt: prompt,
            temperature: 0.5,
            max_tokens: 150,
            top_p: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
        });

        // Extracting generated text from response
        const topicsText = response.data.choices[0].text.trim();
        const topics = topicsText.split('\n').filter(topic => topic); // Splitting topics by newline and filtering out empty strings

        // Send generated topics as response
        res.json({ topics });
    } catch (error) {
        console.error('OpenAI Error:', error);
        res.status(500).send('Failed to generate topics.');
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
