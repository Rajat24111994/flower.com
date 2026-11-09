export function restrictPinInputs() {
    document.querySelectorAll("input[data-pin]").forEach(input => {
        input.addEventListener("input", () => {
            const digits = input.value.replace(/[^0-9]/g, "").slice(0, 6);
            if (input.value !== digits) input.value = digits;
        });
    });
}

export function addQuestionFields(container, prefix) {
    for (let index = 1; index <= 3; index++) {
        for (const kind of ["question", "answer"]) {
            const id = `${prefix}-${kind}-${index}`;
            const label = document.createElement("label");
            label.htmlFor = id;
            label.textContent = kind === "question" ? `Câu hỏi tự đặt ${index}` : `Câu trả lời ${index}`;
            const input = document.createElement("input");
            Object.assign(input, { id, type: kind === "answer" ? "password" : "text", required: true,
                minLength: kind === "answer" ? 6 : 5, maxLength: kind === "answer" ? 200 : 160, autocomplete: "off" });
            if (kind === "answer") input.placeholder = "6–200 ký tự, khó đoán và khác hai đáp án còn lại";
            container.append(label, input);
        }
    }
}

export function readQuestions(prefix) {
    return [1, 2, 3].map(index => ({ question: document.getElementById(`${prefix}-question-${index}`).value,
        answer: document.getElementById(`${prefix}-answer-${index}`).value }));
}

export function recoveryError(error) {
    const remaining = Number.isInteger(error.attemptsRemaining) && error.code !== "pin-reset-required"
        ? ` Bạn còn ${error.attemptsRemaining} lượt thử.` : "";
    const wait = error.retryAfter ? ` Thử lại sau ${Math.ceil(error.retryAfter / 60)} phút.` : "";
    return `${error.message}${remaining}${wait}`;
}
