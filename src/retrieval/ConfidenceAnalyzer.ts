export interface ConfidenceScore {
  isHigh: boolean;
  score: number;
  reason: string;
}

export class ConfidenceAnalyzer {
  analyze(response: string): ConfidenceScore {
    const text = response.toLowerCase();
    
    // Check for explicit uncertainty phrases
    const uncertainPhrases = [
      'need more', 'without seeing', 'not enough context',
      'unclear', 'not sure', 'might be', 'possibly',
      'i don\'t know', 'cannot determine', 'insufficient'
    ];
    
    for (const phrase of uncertainPhrases) {
      if (text.includes(phrase)) {
        return {
          isHigh: false,
          score: 0.3,
          reason: `Contains uncertainty: "${phrase}"`,
        };
      }
    }
    
    // Check response length
    if (response.length < 50) {
      return {
        isHigh: false,
        score: 0.4,
        reason: 'Response too short',
      };
    }
    
    // Check for hedging words
    const hedgeWords = ['maybe', 'perhaps', 'could be', 'seems like'];
    const hedgeCount = hedgeWords.filter(word => text.includes(word)).length;
    
    if (hedgeCount > 2) {
      return {
        isHigh: false,
        score: 0.5,
        reason: 'Too many hedging words',
      };
    }
    
    // Check for code blocks in coding response
    const hasCodeBlock = response.includes('```');
    const mentionsCode = text.includes('function') || text.includes('class') || text.includes('const');
    
    if (mentionsCode && !hasCodeBlock) {
      return {
        isHigh: false,
        score: 0.6,
        reason: 'Missing expected code blocks',
      };
    }
    
    // All checks passed
    return {
      isHigh: true,
      score: 0.9,
      reason: 'Confident response',
    };
  }
}
