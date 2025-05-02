const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate trivia questions using OpenAI
 * @param {string} topic - The topic for trivia questions
 * @param {number} count - Number of questions to generate
 * @returns {Array} - Array of question objects
 */
async function generateTriviaQuestions(topic, count = 5) {
  try {
    console.log(`Generating ${count} trivia questions on topic: ${topic}`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that generates trivia questions."
        },
        {
          role: "user",
          content: `Generate ${count} multiple-choice trivia questions about ${topic}. 
                   Each question should have 4 options with only one correct answer.
                   Format your response as a JSON array with these fields:
                   - id: a unique number for each question (1, 2, 3, etc.)
                   - text: the question text
                   - options: array of 4 possible answers as strings
                   - correctIndex: index of the correct answer (0-3)
                   - timeLimit: time limit in seconds (15)`
        }
      ],
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(response.choices[0].message.content);
    console.log("Successfully generated questions:", data.questions.length);
    
    // Ensure the response has the expected structure
    if (!data.questions || !Array.isArray(data.questions)) {
      throw new Error("Invalid response structure from AI");
    }
    
    // Add UUID to each question
    const questionsWithUuid = data.questions.map(question => ({
      ...question,
      id: uuidv4() // Replace the numeric id with a UUID
    }));
    
    return questionsWithUuid;
  } catch (error) {
    console.error("Error generating trivia questions:", error);
    // Return fallback questions in case of error
    return getFallbackTriviaQuestions();
  }
}

/**
 * Fallback questions in case AI generation fails
 * @returns {Array} - Array of fallback question objects
 */
function getFallbackTriviaQuestions() {
  return [
    {
      id: uuidv4(),
      text: "What is the capital of France?",
      options: ["Berlin", "London", "Paris", "Madrid"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which planet is known as the Red Planet?",
      options: ["Earth", "Mars", "Jupiter", "Venus"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "What element has the chemical symbol 'O'?",
      options: ["Gold", "Oxygen", "Iron", "Carbon"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "What is the largest mammal on Earth?",
      options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Who wrote 'Romeo and Juliet'?",
      options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"],
      correctIndex: 1,
      timeLimit: 15
    }
  ];
}

module.exports = {
  generateTriviaQuestions
};