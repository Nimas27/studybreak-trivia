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
                   Format your response as a JSON object with a 'questions' field containing an array of question objects.
                   Each question object should have these fields:
                   - id: a unique number for each question (1, 2, 3, etc.)
                   - text: the question text
                   - options: array of 4 possible answers as strings
                   - correctIndex: index of the correct answer (0-3)
                   - timeLimit: time limit in seconds (15)`
        }
      ],
      response_format: { type: "json_object" }
    });

    console.log("Received response from OpenAI");
    
    // Debug the raw response content
    const responseContent = response.choices[0].message.content;
    console.log("Response content:", responseContent.substring(0, 100) + "...");
    
    let data;
    try {
      data = JSON.parse(responseContent);
      console.log("Parsed JSON successfully");
      console.log("Data structure:", Object.keys(data));
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      throw new Error("Failed to parse response from OpenAI");
    }
    
    // Check if the response has the expected structure
    if (!data.questions) {
      console.error("Response doesn't contain 'questions' field:", data);
      
      // If we have a different structure, try to adapt
      if (data.trivia_questions) {
        console.log("Found 'trivia_questions' field instead of 'questions'");
        data.questions = data.trivia_questions;
      } else {
        // Create questions from any array we find in the response
        const possibleQuestionArray = Object.values(data).find(val => Array.isArray(val));
        if (possibleQuestionArray) {
          console.log("Found an array in response, using as questions");
          data.questions = possibleQuestionArray;
        } else {
          throw new Error("Response doesn't contain a questions array");
        }
      }
    }
    
    if (!Array.isArray(data.questions)) {
      console.error("'questions' is not an array:", data.questions);
      throw new Error("Response format is incorrect - questions is not an array");
    }
    
    console.log("Successfully found questions array with length:", data.questions.length);
    
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
      text: "What NBA player is known as 'King James'?",
      options: ["Kevin Durant", "LeBron James", "Stephen Curry", "Michael Jordan"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which NBA team has won the most championships?",
      options: ["Los Angeles Lakers", "Boston Celtics", "Chicago Bulls", "Golden State Warriors"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Who holds the NBA record for most points scored in a single game?",
      options: ["Michael Jordan", "Kobe Bryant", "Wilt Chamberlain", "LeBron James"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which player has won the most NBA MVP awards?",
      options: ["Michael Jordan", "LeBron James", "Kareem Abdul-Jabbar", "Bill Russell"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which NBA team drafted Kobe Bryant?",
      options: ["Los Angeles Lakers", "Charlotte Hornets", "Chicago Bulls", "Philadelphia 76ers"],
      correctIndex: 1,
      timeLimit: 15
    }
  ];
}

module.exports = {
  generateTriviaQuestions
};