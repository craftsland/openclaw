import { initialCustodianWizardValue } from "./custodian-wizard-step.ts";
import {
  createCustodianSessionId,
  type CustodianMessage,
  type CustodianTranscriptSnapshot,
} from "./transcript.ts";

/** Transcript-owned state shared by live turns and reload recovery. */
export class CustodianTranscriptState {
  messages: CustodianMessage[] = [];
  sensitive = false;
  wizardInputPending = false;
  wizardValue: unknown;
  wizardSecretVisible = false;
  questionReplyUncertain = false;
  earlierBoundaryAfterId: number | null = null;

  protected sessionId = createCustodianSessionId();
  protected nextMessageId = 1;

  protected applyTranscriptSnapshot(
    transcript: CustodianTranscriptSnapshot,
    recoveredSessionId?: string,
  ): boolean {
    this.messages = transcript.messages;
    this.nextMessageId = transcript.nextMessageId;
    this.earlierBoundaryAfterId = transcript.earlierBoundaryAfterId;
    const step = transcript.recoveredStep;
    if (step && recoveredSessionId) {
      this.sessionId = recoveredSessionId;
      this.sensitive = step.sensitive === true;
      this.wizardInputPending = true;
      this.wizardValue = initialCustodianWizardValue(step);
      this.wizardSecretVisible = false;
      this.questionReplyUncertain = false;
    }
    return step !== undefined;
  }
}
