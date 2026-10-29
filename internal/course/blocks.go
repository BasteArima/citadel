package course

// BlockSpec describes one block type: the fields it must have.
// The same list is served to agents through the API, so they know what is supported.
type BlockSpec struct {
	Type     string   `json:"type"`
	Title    string   `json:"title"`
	Required []string `json:"required"`
}

// Blocks is the registry of known block types.
var Blocks = []BlockSpec{
	{Type: "heading", Title: "Заголовок", Required: []string{"text", "level"}},
	{Type: "text", Title: "Абзац", Required: []string{"html"}},
	{Type: "list", Title: "Список", Required: []string{"items"}},
	{Type: "code", Title: "Код", Required: []string{"code"}},
	{Type: "table", Title: "Таблица", Required: []string{"head", "rows"}},
	{Type: "callout", Title: "Врезка", Required: []string{"kind", "html"}},
	{Type: "scheme", Title: "Схема", Required: []string{"html"}},
	{Type: "steps", Title: "Пошагово", Required: []string{"items"}},
	{Type: "anim", Title: "Анимация", Required: []string{"els", "steps"}},
	{Type: "predict", Title: "Предскажи и запусти", Required: []string{"code"}},
	{Type: "question", Title: "Вопрос", Required: []string{"id", "kind", "q"}},
	{Type: "hands", Title: "Сделай руками", Required: []string{"steps"}},
	{Type: "embed", Title: "Свой компонент", Required: []string{"src"}},
}

// Callout kinds and question kinds.
var (
	CalloutKinds  = []string{"note", "warn", "cs"}
	QuestionKinds = []string{"choice", "text", "order"}
)

// Spec returns the spec of a block type.
func Spec(typ string) (BlockSpec, bool) {
	for _, s := range Blocks {
		if s.Type == typ {
			return s, true
		}
	}
	return BlockSpec{}, false
}
