import streamlit as st
import pandas as pd
import openai
import base64
from datetime import datetime

# --- 1. НАСТРОЙКИ ---
st.set_page_config(page_title="TruckControl AI", layout="wide", page_icon="🚛")

# Сложи твоя ключ тук
OPENAI_API_KEY = "sk-proj-hMRA7YEA8TYUrC5YCvCW814AEayITse-HsbTMg8WxoUNGP9n0RTb3SuHQYjjkeQiARS0e4fcr-T3B1bkF JpfXElUV3K-1Cdolc5wK9kkDB0e8CN5QVMIult54yngX0hMUhNsGGEQ4LmaajDZnLuhIqlMYUYA"

client = openai.OpenAI(api_key=OPENAI_API_KEY)

# --- 2. МЕНЮ (ИЗЧИСТЕНO ОТ ГРЕШКИ) ---
st.sidebar.title("TruckControl AI")
menu = st.sidebar.selectbox("ИЗБЕРИ РАЗДЕЛ:", ["Dashboard", "Scanner", "Finance", "Settings"])

# --- 3. ЛОГИКА НА СТРАНИЦИТЕ ---

if menu == "Dashboard":
    st.title("Табло за управление")
    
    # Показатели
    col1, col2, col3 = st.columns(3)
    col1.metric("Активни камиони", "12", "+2")
    col2.metric("Приход (€)", "42,500", "+8%")
    col3.metric("Печалба (€)", "18,230", "🔥")
    
    st.markdown("---")
    
    # Карта
    st.subheader("Локация на флота")
    map_df = pd.DataFrame({'lat': [42.6977, 52.5200], 'lon': [23.3219, 13.4050]})
    st.map(map_df)

elif menu == "Scanner":
    st.title("AI Скенер за ЧМР")
    file = st.file_uploader("Качи снимка на документ", type=["jpg", "png", "jpeg"])
    
    if file:
        st.image(file, width=400)
        if st.button("АНАЛИЗИРАЙ"):
            with st.spinner('AI обработва...'):
                try:
                    base64_image = base64.b64encode(file.getvalue()).decode('utf-8')
                    response = client.chat.completions.create(
                        model="gpt-4o",
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Extract CMR details: Number, Goods, Weight."},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                            ],
                        }]
                    )
                    st.info(response.choices[0].message.content)
                except Exception as e:
                    st.error(f"Грешка: {e}")

elif menu == "Finance":
    st.title("Финансов отчет")
    finance_data = pd.DataFrame({
        'Камион': ['CB1234AB', 'CB5678XY', 'CB0001PK'],
        'Разход (€)': [720, 680, 810],
        'Печалба (€)': [1380, 1170, 1590]
    })
    st.table(finance_data)
    st.bar_chart(finance_data.set_index('Камион')['Печалба (€)'])

elif menu == "Settings":
    st.title("Настройки на GPS")
    st.text_input("Въведи номер на камион")
    st.text_input("API Ключ за GPS система")
    if st.button("ЗАПИШИ"):
        st.success("Системата е свързана!")