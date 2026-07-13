export default function Terms() {
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem', fontFamily: 'Merriweather, serif' }}>

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#2D3DCA', margin: '0 0 4px' }}>senseUS</h1>
        <h2 style={{ fontSize: '22px', fontWeight: 600, color: '#1A1A1A', margin: '0 0 8px' }}>Terms of Service</h2>
        <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>Last updated: July 11, 2026 — Version 1.0</p>
      </div>

      <div style={{ background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '8px', padding: '12px 16px', marginBottom: '2rem', fontSize: '13px', color: '#0C447C' }}>
        By creating an account or using senseUS, you agree to be bound by these Terms of Service.
      </div>

      {[
        {
          title: '1. Agreement to These Terms',
          content: 'By creating an account or using senseUS ("the platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use senseUS. senseUS is operated and owned by Gudboi Enterprises, LLC, but will be a Delaware Public Benefit Corporation eventually. ("we," "us," or "our").'
        },
        {
          title: '2. Eligibility',
          content: 'To use senseUS, you must:',
          bullets: [
            'Be at least 18 years of age',
            'Be a human being (not an automated system, bot, or artificial intelligence)',
            'Have a valid phone number capable of receiving SMS messages',
            'Not be prohibited from using the platform under applicable law',
            'Not be located in a country subject to applicable sanctions',
          ],
          after: 'By using senseUS, you represent and warrant that you meet all of these requirements.'
        },
        {
          title: '3. One Account Per Person',
          content: 'senseUS is built on the principle of one verified human, one account, one voice. You may not:',
          bullets: [
            'Create more than one account',
            'Create an account on behalf of another person',
            'Use a virtual, VoIP, or temporary phone number to create an account',
            'Share your account with any other person',
            'Allow any automated system to access your account or cast votes on your behalf',
          ],
          after: 'Violations of this section are the most serious breach of these Terms and will result in immediate permanent account termination.'
        },
        {
          title: '4. Account Creation and Verification',
          content: 'Creating an account requires verification of a real phone number via one-time SMS code. You agree to:',
          bullets: [
            'Provide accurate information during account setup',
            'Use only a phone number that you own and control',
            'Keep your account information current',
            'Notify us immediately at security@senseus.app if you believe your account has been compromised',
          ]
        },
        {
          title: '5. Your Votes',
          content: 'You may change your vote on any question at any time. Every vote change is logged with a timestamp for transparency and integrity purposes. The most recent vote is the one that counts.',
          bullets: [
            'Your most recent vote is what counts in aggregate results',
            'All vote changes are logged anonymously with timestamps — this is part of our integrity system',
            'Your votes and vote history may be included in anonymized aggregate data products licensed to business customers',
            'Your individual vote will never be identified or attributed to you in any external data product',
          ],
          after: 'Questions you skip ("make up my mind" without voting) are not votes and are not recorded as responses.'
        },
        {
          title: '6. Your Content',
          content: 'By posting replies in discussion threads, you grant senseUS a non-exclusive, royalty-free, worldwide license to display and distribute that content within the platform. You retain ownership of your content. You represent that you have the right to post it.',
        },
        {
          title: '7. Prohibited Conduct',
          content: 'You agree not to use senseUS to:',
          bullets: [
            'Post content that is hateful, harassing, threatening, or discriminatory toward any individual or group',
            'Post content that targets a person\'s identity — including race, ethnicity, gender, religion, sexual orientation, or disability',
            'Coordinate with others to manipulate vote outcomes',
            'Use automated tools, bots, or scripts to interact with the platform',
            'Attempt to circumvent our verification or fraud detection systems',
            'Impersonate another person or misrepresent your identity',
            'Post content that violates any applicable law',
            'Scrape or systematically collect data from the platform without our express written permission',
          ]
        },
        {
          title: '8. Community Guidelines',
          content: 'senseUS welcomes disagreement. Provocative debate about ideas, culture, and public affairs is encouraged. What is not permitted is content that targets people rather than ideas. Our moderation systems apply the same standards symmetrically to all viewpoints.',
          bullets: [
            'Disagreement and strong opinions: permitted',
            'Sharp rebuttals of ideas and arguments: permitted',
            'Content targeting individuals based on identity characteristics: not permitted',
            'Hate speech, regardless of the viewpoint expressed: not permitted',
            'Pile-ons and coordinated harassment: not permitted',
          ]
        },
        {
          title: '9. Our Policy on Artificial Intelligence',
          content: 'senseUS has a strict conflict-of-interest policy regarding AI:',
          bullets: [
            'AI systems never author, modify, or solely moderate questions about artificial intelligence',
            'AI systems never select or curate articles shown in the "Make Up My Mind" module for AI-related questions',
            'AI moderation decisions on AI-related replies are automatically escalated to human review',
            'This policy is encoded in our platform architecture and subject to quarterly audit',
          ]
        },
        {
          title: '10. Data and Privacy',
          content: 'Your use of senseUS is also governed by our Privacy Policy, available at senseus.app/privacy, which is incorporated into these Terms by reference.',
          bullets: [
            'We never sell individual vote data or individual opinion records',
            'B2B data products contain only anonymized aggregate statistics',
            'Your phone number is not stored after verification',
            'Your full date of birth is not stored after the age gate',
            'Your full last name is never stored',
          ]
        },
        {
          title: '11. Intellectual Property',
          content: 'The senseUS platform, including its design, branding, software, and methodology, is owned by [ENTITY NAME] and protected by applicable intellectual property law. The senseUS name, logo, and tagline "real humans. real opinions. real truth." are trademarks of [ENTITY NAME]. You may not reproduce or create derivative works from any part of the platform without our express written permission.'
        },
        {
          title: '12. Disclaimers',
          content: 'SENSEUS IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED OR ERROR-FREE. The opinions expressed by users are those of the individual users and do not represent the views of senseUS.'
        },
        {
          title: '13. Limitation of Liability',
          content: 'TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, [ENTITY NAME] SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF SENSEUS. OUR TOTAL LIABILITY SHALL NOT EXCEED THE GREATER OF THE AMOUNT YOU PAID US IN THE PRECEDING TWELVE MONTHS OR ONE HUNDRED U.S. DOLLARS ($100).'
        },
        {
          title: '14. Indemnification',
          content: 'You agree to indemnify and hold harmless [ENTITY NAME] and its officers, directors, employees, and agents from any claims, liabilities, damages, or expenses arising from your use of senseUS or your violation of these Terms.'
        },
        {
          title: '15. Termination',
          content: 'You may delete your account at any time from within the app. We may suspend or terminate your account at any time for violation of these Terms or suspected fraud. Upon termination, your profile will be removed. Your votes will be retained in anonymized form as described in our Privacy Policy.'
        },
        {
          title: '16. Governing Law and Dispute Resolution',
          content: 'These Terms are governed by the laws of the State of Delaware. Any dispute shall be resolved by binding arbitration under AAA rules. YOU WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.'
        },
        {
          title: '17. Changes to These Terms',
          content: 'We may update these Terms from time to time. We will notify you of material changes by posting a notice on the platform and updating the "Last updated" date above. For material changes affecting your rights, we will provide at least 30 days\' notice.'
        },
        {
          title: '18. Miscellaneous',
          bullets: [
            'Entire agreement: These Terms and our Privacy Policy constitute the entire agreement between you and [ENTITY NAME].',
            'Severability: If any provision is found unenforceable, the remaining provisions continue in full force.',
            'No waiver: Our failure to enforce any provision does not constitute a waiver.',
            'Assignment: You may not assign your rights under these Terms.',
          ]
        },
        {
          title: '19. Contact',
          content: 'For questions about these Terms:',
          bullets: [
            'Email: legal@senseus.app',
            'Mailing address: [ADDRESS — to be completed after entity formation]',
          ]
        },
      ].map((section, i) => (
        <div key={i} style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#2D3DCA', marginBottom: '0.75rem', paddingBottom: '6px', borderBottom: '1px solid #E5E7EB' }}>
            {section.title}
          </h2>
          {section.content && <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#1A1A1A', marginBottom: '0.75rem' }}>{section.content}</p>}
          {section.bullets && (
            <ul style={{ paddingLeft: '1.5rem', margin: '0 0 0.75rem' }}>
              {section.bullets.map((b, j) => (
                <li key={j} style={{ fontSize: '14px', lineHeight: 1.7, color: '#1A1A1A', marginBottom: '4px' }}>{b}</li>
              ))}
            </ul>
          )}
          {section.after && <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#1A1A1A' }}>{section.after}</p>}
        </div>
      ))}

      <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '1.5rem', marginTop: '2rem', fontSize: '12px', color: '#6B7280', textAlign: 'center' }}>
        senseUS · real humans. real opinions. real truth. · senseus.app
      </div>
    </div>
  )
}